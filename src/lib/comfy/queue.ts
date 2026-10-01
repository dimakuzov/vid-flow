import fs from "fs";
import path from "path";
import {
  downloadComfyImage,
  listHistoryImages,
  readComfyHistory,
  submitComfyPrompt,
  uploadComfyImage,
} from "./client";
import { getComfyQueueRoot, getDataRoot, getPlaybooksRoot } from "../series/paths";

export interface ComfyJob {
  id: string;
  status: "pending" | "running" | "done" | "error";
  prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  uploads?: { path: string; filename?: string }[];
  saveTo: string;
  promptId?: string;
  files?: string[];
  error?: string;
  updatedAt?: string;
}

const running = new Set<string>();
const HISTORY_TIMEOUT_MS = 15 * 60 * 1000;
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
  const next: ComfyJob = { ...job, status: "pending", error: undefined, files: undefined, promptId: undefined };
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

async function submitJob(job: ComfyJob): Promise<void> {
  const saveDir = resolveSaveDir(job.saveTo);
  fs.mkdirSync(saveDir, { recursive: true });
  for (const upload of job.uploads || []) {
    const source = resolveReadable(upload.path);
    const filename = upload.filename || path.basename(source);
    await uploadComfyImage(fs.readFileSync(source), filename);
  }
  job.promptId = await submitComfyPrompt(job.prompt);
  job.status = "running";
  job.error = undefined;
  writeJob(job);
}

async function finishJob(job: ComfyJob): Promise<void> {
  if (!job.promptId) return;
  const history = await readComfyHistory(job.promptId);
  if (!history) {
    const started = job.updatedAt ? Date.parse(job.updatedAt) : Number.NaN;
    if (Number.isFinite(started) && Date.now() - started > HISTORY_TIMEOUT_MS) {
      throw new Error(`история ${job.promptId} не пришла`);
    }
    return;
  }
  const saveDir = resolveSaveDir(job.saveTo);
  fs.mkdirSync(saveDir, { recursive: true });
  const saved: string[] = [];
  for (const image of listHistoryImages(history)) {
    const bytes = await downloadComfyImage(image);
    const name = path.basename(image.filename);
    fs.writeFileSync(path.join(saveDir, name), bytes);
    saved.push(name);
  }
  if (!saved.length) throw new Error("ComfyUI не вернул картинок");
  job.status = "done";
  job.files = saved;
  job.error = undefined;
  writeJob(job);
}

function failJob(job: ComfyJob, error: unknown): void {
  job.status = "error";
  job.error = error instanceof Error ? error.message : "ошибка ComfyUI";
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
      if (!needsSubmit || offline || running.has(job.id) || !claimJob(job.id)) continue;
      running.add(job.id);
      job.status = "running";
      job.error = undefined;
      try {
        writeJob(job);
        await submitJob(job);
      } catch (error) {
        if (comfyOffline(error)) {
          offline = true;
          job.status = "pending";
          job.promptId = undefined;
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

    for (const job of jobs) {
      if (job.status !== "running" || !job.promptId || running.has(job.id) || !claimJob(job.id)) continue;
      running.add(job.id);
      try {
        await finishJob(job);
      } catch (error) {
        if (!comfyOffline(error)) failJob(job, error);
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
  const marker = globalThis as typeof globalThis & { __frameboardComfyQueue?: boolean };
  if (marker.__frameboardComfyQueue) return;
  marker.__frameboardComfyQueue = true;
  setInterval(() => {
    void drainComfyQueue();
  }, 2000);
  void drainComfyQueue();
}
