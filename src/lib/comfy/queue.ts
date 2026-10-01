import fs from "fs";
import path from "path";
import {
  downloadComfyImage,
  listHistoryImages,
  submitComfyPrompt,
  uploadComfyImage,
  waitComfyHistory,
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

function claimJob(id: string): boolean {
  const lock = path.join(queueDir(), `${id}.lock`);
  try {
    const stat = fs.statSync(lock);
    if (Date.now() - stat.mtimeMs > 20 * 60 * 1000) fs.unlinkSync(lock);
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
  const file = jobPath(job.id);
  fs.writeFileSync(file, JSON.stringify({ ...job, updatedAt: new Date().toISOString() }, null, 2) + "\n");
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

async function runJob(job: ComfyJob): Promise<void> {
  const saveDir = resolveSaveDir(job.saveTo);
  fs.mkdirSync(saveDir, { recursive: true });
  for (const upload of job.uploads || []) {
    const source = resolveReadable(upload.path);
    const filename = upload.filename || path.basename(source);
    await uploadComfyImage(fs.readFileSync(source), filename);
  }
  const promptId = await submitComfyPrompt(job.prompt);
  job.promptId = promptId;
  writeJob(job);
  const history = await waitComfyHistory(promptId);
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

export async function drainComfyQueue(): Promise<void> {
  const dir = queueDir();
  const names = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  for (const name of names) {
    const id = name.slice(0, -".json".length);
    if (running.has(id)) continue;
    let job: ComfyJob;
    try {
      job = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as ComfyJob;
    } catch {
      continue;
    }
    if (job.status !== "pending" || job.id !== id) continue;
    if (!claimJob(id)) continue;
    running.add(id);
    job.status = "running";
    job.error = undefined;
    try {
      writeJob(job);
      await runJob(job);
    } catch (error) {
      job.status = "error";
      job.error = error instanceof Error ? error.message : "ошибка ComfyUI";
      try {
        writeJob(job);
      } catch {
        // The job id or save path was rejected before a file could be updated.
      }
    } finally {
      running.delete(id);
      releaseJob(id);
    }
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
