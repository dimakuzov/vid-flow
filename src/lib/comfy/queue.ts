import fs from "fs";
import path from "path";
import {
  cancelComfyPrompt,
  ComfyRejectedError,
  downloadComfyImage,
  historyError,
  listHistoryImages,
  listHistoryTexts,
  queuePositionOf,
  readComfyHistory,
  readComfyQueue,
  submitComfyPrompt,
  uploadComfyImage,
} from "./client";
import {
  cancelCloudJob,
  downloadCloudFile,
  readCloudJob,
  renameUploads,
  submitCloudPrompt,
  uploadCloudImage,
} from "./cloud";
import { registerLoop } from "../background";
import { getComfyQueueRoot, getDataRoot, getPlaybooksRoot } from "../series/paths";

import type { ComfyJob } from "../contracts/comfy-job";

// Схема задания — docs/contracts/comfy-job.md.
export type { ComfyJob };

const running = new Set<string>();
/** Сколько ждать историю пропавшего из очереди задания, прежде чем отправить его заново. */
const LOST_GRACE_MS = 60 * 1000;
/** Сколько раз отправлять заново потерянное задание. */
const MAX_RESTARTS = 2;
/** Облако опрашивается реже локального ComfyUI: видео там идёт минутами. */
const CLOUD_POLL_MS = 15 * 1000;
const lastCloudPoll = new Map<string, number>();

function isCloud(job: ComfyJob): boolean {
  return job.target === "cloud";
}
let draining = false;

function processAlive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function comfyOffline(error: unknown): boolean {
  const codes = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
  ]);
  const seen = new Set<unknown>();
  const stack: unknown[] = [error];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if ("code" in current && codes.has(String((current as { code: unknown }).code))) return true;
    if ("cause" in current) stack.push((current as { cause: unknown }).cause);
    if ("errors" in current && Array.isArray((current as { errors: unknown[] }).errors)) {
      stack.push(...(current as { errors: unknown[] }).errors);
    }
  }
  return error instanceof TypeError && /fetch failed|network/i.test(error.message);
}

function claimJob(id: string): boolean {
  const lock = path.join(queueDir(), `${id}.lock`);
  try {
    const stat = fs.statSync(lock);
    const pid = Number(fs.readFileSync(lock, "utf8").trim());
    const stale = Date.now() - stat.mtimeMs > 20 * 60 * 1000;
    if (stale || !processAlive(pid)) fs.unlinkSync(lock);
  } catch {
    // No lock yet.
  }
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

function releaseJob(id: string): void {
  fs.rmSync(path.join(queueDir(), `${id}.lock`), { force: true });
}

function queueDir(): string {
  const dir = getComfyQueueRoot();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** id одного персонажа в запуске этапа. Латиница, не длиннее 81 символа (контракт очереди). */
export function characterJobId(shotId: string, workflow: string, character: string, stamp: number): string {
  const safe = character.toLowerCase().replace(/[^a-z0-9_-]/g, "") || "x";
  const id = `${shotId}-${workflow}-${safe}-${stamp}`;
  return id.length <= 81 ? id : id.slice(0, 81);
}

function jobPath(id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(id)) {
    throw new Error("id задания: латиница, цифры, точка, _ и -");
  }
  return path.join(queueDir(), `${id}.json`);
}

function inside(root: string, target: string): boolean {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  return resolved === base || resolved.startsWith(base + path.sep);
}

function resolveReadable(filePath: string): string {
  const resolved = path.resolve(process.cwd(), filePath);
  if (inside(getDataRoot(), resolved) || inside(getPlaybooksRoot(), resolved)) return resolved;
  throw new Error(`файл вне data/ и playbooks/: ${filePath}`);
}

function resolveSaveDir(filePath: string): string {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!inside(getDataRoot(), resolved)) throw new Error(`saveTo вне data/: ${filePath}`);
  return resolved;
}

function writeJob(job: ComfyJob): void {
  job.updatedAt = new Date().toISOString();
  fs.writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2) + "\n");
}

export function readComfyJob(id: string): ComfyJob | null {
  const file = jobPath(id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as ComfyJob;
}

export function enqueueComfyJob(job: ComfyJob): ComfyJob {
  if (!job.prompt || typeof job.prompt !== "object") throw new Error("prompt обязателен");
  resolveSaveDir(job.saveTo);
  for (const upload of job.uploads || []) resolveReadable(upload.path);
  const next: ComfyJob = {
    ...job,
    status: "pending",
    queuedAt: job.queuedAt || new Date().toISOString(),
    error: undefined,
    nodeErrors: undefined,
    files: undefined,
    promptId: undefined,
    submittedAt: undefined,
    finishedAt: undefined,
    queuePosition: null,
  };
  writeJob(next);
  return next;
}

function listJobs(): ComfyJob[] {
  const dir = queueDir();
  const names = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  const jobs: ComfyJob[] = [];
  for (const name of names) {
    const id = name.slice(0, -".json".length);
    try {
      const job = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as ComfyJob;
      if (job.id === id) jobs.push(job);
    } catch {
      // A writer still has this file open.
    }
  }
  return jobs;
}

/**
 * Comfy Cloud: загрузить файлы, подставить облачные имена в граф, отправить один раз.
 * Ошибка на любом шаге — задание error, без повтора: отправка платная.
 */
async function submitCloudJob(job: ComfyJob): Promise<void> {
  fs.mkdirSync(resolveSaveDir(job.saveTo), { recursive: true });
  const names = new Map<string, string>();
  for (const upload of job.uploads || []) {
    const source = resolveReadable(upload.path);
    const filename = upload.filename || path.basename(source);
    names.set(filename, await uploadCloudImage(fs.readFileSync(source), filename));
  }
  if (cancelledMeanwhile(job.id)) return;
  const promptId = await submitCloudPrompt(renameUploads(job.prompt, names));
  if (cancelledMeanwhile(job.id)) {
    await cancelCloudJob(promptId);
    return;
  }
  job.promptId = promptId;
  job.status = "running";
  job.submittedAt = new Date().toISOString();
  job.queuePosition = null;
  job.error = undefined;
  writeJob(job);
}

/** Опрос облака: готово — скачать файлы в saveTo, ошибка — error. Сбой сети — спросить позже. */
async function finishCloudJob(job: ComfyJob): Promise<void> {
  if (!job.promptId) return;
  const last = lastCloudPoll.get(job.id) ?? 0;
  if (Date.now() - last < CLOUD_POLL_MS) return;
  lastCloudPoll.set(job.id, Date.now());
  // Сбой сети или облака при опросе — не провал: прогон уже оплачен, спросим снова.
  let cloud: Awaited<ReturnType<typeof readCloudJob>>;
  try {
    cloud = await readCloudJob(job.promptId);
  } catch {
    return;
  }
  if (cloud.status === "pending" || cloud.status === "in_progress") return;
  if (cloud.status === "cancelled") {
    if (cancelledMeanwhile(job.id)) return;
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    writeJob(job);
    return;
  }
  if (cloud.status === "failed") throw new ComfyRejectedError(cloud.error || "Comfy Cloud: прогон завершился с ошибкой");
  const saveDir = resolveSaveDir(job.saveTo);
  fs.mkdirSync(saveDir, { recursive: true });
  const files = listHistoryImages({ outputs: cloud.outputs });
  if (!files.length) throw new Error("Comfy Cloud не вернул файлов");
  // Сначала скачать всё: не скачалось — повторим на следующем опросе, файлов не дублируя.
  let downloaded: { name: string; bytes: Buffer }[];
  try {
    downloaded = await Promise.all(
      files.map(async (file) => ({ name: path.basename(file.filename), bytes: await downloadCloudFile(file) })),
    );
  } catch {
    return;
  }
  const saved = downloaded.map((file) => writeUnique(saveDir, file.name, file.bytes));
  if (cancelledMeanwhile(job.id)) return;
  lastCloudPoll.delete(job.id);
  job.status = "done";
  job.files = saved;
  job.finishedAt = new Date().toISOString();
  job.error = undefined;
  job.nodeErrors = undefined;
  writeJob(job);
}

async function submitJob(job: ComfyJob): Promise<void> {
  if (isCloud(job)) return submitCloudJob(job);
  const saveDir = resolveSaveDir(job.saveTo);
  fs.mkdirSync(saveDir, { recursive: true });
  for (const upload of job.uploads || []) {
    const source = resolveReadable(upload.path);
    const filename = upload.filename || path.basename(source);
    await uploadComfyImage(fs.readFileSync(source), filename);
  }
  if (cancelledMeanwhile(job.id)) return;
  const promptId = await submitComfyPrompt(job.prompt);
  // «Отменить» могли нажать, пока шёл запрос: не затираем cancelled и снимаем prompt из ComfyUI.
  if (cancelledMeanwhile(job.id)) {
    await cancelComfyPrompt(promptId);
    return;
  }
  job.promptId = promptId;
  job.status = "running";
  job.submittedAt = new Date().toISOString();
  job.queuePosition = null;
  job.error = undefined;
  writeJob(job);
}

/** Имя в dir, которого ещё нет: name.png → name-2.png, name-3.png… */
function writeUnique(dir: string, name: string, bytes: Buffer): string {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? name : `${base}-${n}${ext}`;
    try {
      // wx: существующий файл не затирается. Байты как есть: метаданные PNG остаются.
      fs.writeFileSync(path.join(dir, candidate), bytes, { flag: "wx" });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

type QueueSnapshot = { running: string[]; pending: string[] } | null;

async function finishJob(job: ComfyJob, queue: QueueSnapshot): Promise<void> {
  if (isCloud(job)) return finishCloudJob(job);
  if (!job.promptId) return;
  const history = await readComfyHistory(job.promptId);
  if (!history) {
    const position = queue ? queuePositionOf(queue, job.promptId) : (job.queuePosition ?? null);
    if (position != null || !queue) {
      // Ждёт или выполняется (или ComfyUI не отвечает — ждём, пока поднимется): не потеря.
      if (queue && (position !== (job.queuePosition ?? null) || job.lostAt) && !cancelledMeanwhile(job.id)) {
        job.queuePosition = position;
        job.lostAt = undefined;
        writeJob(job);
      }
      return;
    }
    // ComfyUI работает, а задания нет ни в очереди, ни в истории: его перезапускали
    // (или компьютер выключался). Минута на случай, если история пишется с задержкой.
    if (!job.lostAt) {
      if (cancelledMeanwhile(job.id)) return;
      job.lostAt = new Date().toISOString();
      job.queuePosition = null;
      writeJob(job);
      return;
    }
    if (Date.now() - Date.parse(job.lostAt) < LOST_GRACE_MS) return;
    const restarts = job.restarts ?? 0;
    if (restarts >= MAX_RESTARTS) {
      throw new Error(
        `ComfyUI потерял задание ${restarts + 1} раза подряд (${job.promptId} нет ни в очереди, ни в истории). Запустите этап заново.`,
      );
    }
    if (cancelledMeanwhile(job.id)) return;
    // Отправить заново: следующий проход цикла поставит его в ComfyUI.
    job.status = "pending";
    job.promptId = undefined;
    job.submittedAt = undefined;
    job.queuePosition = null;
    job.lostAt = undefined;
    job.restarts = restarts + 1;
    writeJob(job);
    return;
  }
  const failed = historyError(history);
  if (failed) throw failed;
  const saveDir = resolveSaveDir(job.saveTo);
  fs.mkdirSync(saveDir, { recursive: true });
  const saved: string[] = [];
  for (const image of listHistoryImages(history)) {
    const bytes = await downloadComfyImage(image);
    saved.push(writeUnique(saveDir, path.basename(image.filename), bytes));
  }
  if (job.saveText) {
    for (const { node, text } of listHistoryTexts(history)) {
      saved.push(writeUnique(saveDir, `${node.replace(/[^\w-]/g, "_")}.txt`, Buffer.from(text, "utf8")));
    }
  }
  if (!saved.length) throw new Error("ComfyUI не вернул файлов");
  if (cancelledMeanwhile(job.id)) return;
  job.status = "done";
  job.files = saved;
  job.queuePosition = null;
  job.finishedAt = new Date().toISOString();
  job.error = undefined;
  job.nodeErrors = undefined;
  writeJob(job);
  // Статус этапа отдельно не пишем: stage_state.json ссылается на это задание по id,
  // а «На проверке» выводится из файлов в output/.
}

function cancelledMeanwhile(id: string): boolean {
  try {
    return readComfyJob(id)?.status === "cancelled";
  } catch {
    return false;
  }
}

/** Задание могли отменить, пока цикл держал его старую копию. */
function stillSame(job: ComfyJob): boolean {
  try {
    const fresh = readComfyJob(job.id);
    return !!fresh && fresh.status === job.status;
  } catch {
    return false;
  }
}

export async function cancelComfyJob(id: string): Promise<void> {
  const job = readComfyJob(id);
  if (!job || job.status === "done" || job.status === "error" || job.status === "cancelled") return;
  if (job.promptId) {
    if (isCloud(job)) await cancelCloudJob(job.promptId);
    else await cancelComfyPrompt(job.promptId);
  }
  job.status = "cancelled";
  job.error = undefined;
  job.queuePosition = null;
  job.finishedAt = new Date().toISOString();
  writeJob(job);
}

function failJob(job: ComfyJob, error: unknown): void {
  job.status = "error";
  job.error = error instanceof Error ? error.message : "ошибка ComfyUI";
  job.nodeErrors = error instanceof ComfyRejectedError && error.nodeErrors.length ? error.nodeErrors : undefined;
  job.queuePosition = null;
  job.finishedAt = new Date().toISOString();
  try {
    writeJob(job);
  } catch {
    // The job id or save path was rejected before a file could be updated.
  }
}

export async function drainComfyQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const jobs = listJobs();
    let offline = false;
    for (const job of jobs) {
      const needsSubmit = job.status === "pending" || (job.status === "running" && !job.promptId);
      if (!needsSubmit || running.has(job.id)) continue;
      if (offline && !isCloud(job)) continue;
      if (!claimJob(job.id)) continue;
      if (!stillSame(job)) {
        releaseJob(job.id);
        continue;
      }
      if (isCloud(job) && job.status === "running") {
        // Прошлая отправка в облако прервалась (перезапуск доски): могла уже списать кредиты.
        // Сами не повторяем — решает пользователь.
        failJob(job, new Error(
          "Отправка в Comfy Cloud прервалась на середине. Проверьте задания на cloud.comfy.org, прежде чем запускать снова: кредиты могли уже списаться.",
        ));
        releaseJob(job.id);
        continue;
      }
      running.add(job.id);
      job.status = "running";
      job.error = undefined;
      try {
        writeJob(job);
        await submitJob(job);
      } catch (error) {
        if (cancelledMeanwhile(job.id)) {
          // Отменённое задание оставляем отменённым.
        } else if (comfyOffline(error) && !isCloud(job)) {
          offline = true;
          job.status = "pending";
          job.promptId = undefined;
          job.submittedAt = undefined;
          job.error = undefined;
          try {
            writeJob(job);
          } catch {
            // Leave the file as the last successful write.
          }
        } else {
          failJob(job, error);
        }
      } finally {
        running.delete(job.id);
        releaseJob(job.id);
      }
    }

    // Одна выборка GET /queue на проход: место в очереди для всех отправленных заданий.
    const sent = jobs.filter((job) => job.status === "running" && job.promptId);
    let queue: QueueSnapshot = null;
    if (sent.some((job) => !isCloud(job))) {
      try {
        queue = await readComfyQueue();
      } catch {
        queue = null;
      }
    }
    for (const job of sent) {
      if (running.has(job.id) || !claimJob(job.id)) continue;
      if (!stillSame(job)) {
        releaseJob(job.id);
        continue;
      }
      running.add(job.id);
      try {
        await finishJob(job, queue);
      } catch (error) {
        if (!comfyOffline(error) && !cancelledMeanwhile(job.id)) failJob(job, error);
      } finally {
        running.delete(job.id);
        releaseJob(job.id);
      }
    }
  } finally {
    draining = false;
  }
}

export function startComfyQueue(): void {
  registerLoop("comfy-queue", 2000, drainComfyQueue);
}
