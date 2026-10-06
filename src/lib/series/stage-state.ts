import fs from "fs";
import path from "path";
import type { StageId } from "./constants";
import { getComfyQueueRoot, stageDir } from "./paths";

/**
 * Активная операция этапа. Пишет только процесс доски (API и фоновый цикл).
 * Агент этот файл не трогает: его сигнал — `"status": "done"` в agent_request.json.
 *
 * - agent: ждём агента (запрос отправлен)
 * - comfy: задание в data/comfy_queue; queued/running берутся из файла задания
 * - error: последняя операция упала, текст в `error`
 * - idle: активной операции нет, статус выводится из папок (prep/review/approved)
 */
export type StoredPhase = "idle" | "agent" | "comfy" | "error";

/** То, что видит интерфейс. */
export type StagePhase = "idle" | "agent" | "queued" | "running" | "error";

export interface StageStateFile {
  phase: StoredPhase;
  since: string;
  requestId?: string;
  jobId?: string;
  /** Агент сам гоняет Comfy (этап characters): доска не ставит задание после done. */
  agentRunsComfy?: boolean;
  error?: string;
  updatedAt: string;
}

export interface StageState {
  phase: StagePhase;
  since: string | null;
  requestId: string | null;
  jobId: string | null;
  error: string | null;
  busy: boolean;
}

const STATE_FILE = "stage_state.json";

export const AGENT_TIMEOUT_MS =
  Math.max(1, Number(process.env.FRAMEBOARD_AGENT_TIMEOUT_MIN) || 60) * 60 * 1000;

export const PHASE_LABELS: Record<StagePhase, string> = {
  idle: "",
  agent: "Агент обрабатывает",
  queued: "Ожидает очереди",
  running: "Генерация в ComfyUI",
  error: "Ошибка",
};

function statePath(shotId: string, stageId: StageId, root?: string): string {
  return path.join(stageDir(shotId, stageId, root), STATE_FILE);
}

export function readStageStateFile(
  shotId: string,
  stageId: StageId,
  root?: string,
): StageStateFile | null {
  try {
    const data = JSON.parse(fs.readFileSync(statePath(shotId, stageId, root), "utf8")) as StageStateFile;
    if (!data || typeof data.phase !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

export function writeStageState(
  shotId: string,
  stageId: StageId,
  next: Omit<StageStateFile, "since" | "updatedAt"> & { since?: string },
  root?: string,
): StageStateFile {
  const now = new Date().toISOString();
  const data: StageStateFile = { ...next, since: next.since || now, updatedAt: now };
  const file = statePath(shotId, stageId, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  return data;
}

export function setIdle(shotId: string, stageId: StageId, root?: string): StageStateFile {
  return writeStageState(shotId, stageId, { phase: "idle" }, root);
}

export function setError(
  shotId: string,
  stageId: StageId,
  error: string,
  root?: string,
): StageStateFile {
  const prev = readStageStateFile(shotId, stageId, root);
  return writeStageState(
    shotId,
    stageId,
    { phase: "error", error, requestId: prev?.requestId, jobId: prev?.jobId },
    root,
  );
}

interface JobSnapshot {
  status: string;
  promptId?: string;
  error?: string;
}

/** Читает файл задания очереди без побочных эффектов. null — файла нет или он ещё пишется. */
export function readJobSnapshot(jobId: string): JobSnapshot | null | "missing" {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(jobId)) return "missing";
  const file = path.join(getComfyQueueRoot(), `${jobId}.json`);
  if (!fs.existsSync(file)) return "missing";
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as JobSnapshot;
  } catch {
    return null;
  }
}

/**
 * Фаза, которую видит интерфейс. Чистое чтение: ничего не пишет.
 * Переводы comfy → idle/error и таймаут агента записывает фоновый цикл (reconcileStageState).
 */
export function readStageState(shotId: string, stageId: StageId, root?: string): StageState {
  const file = readStageStateFile(shotId, stageId, root);
  const base = {
    since: file?.since ?? null,
    requestId: file?.requestId ?? null,
    jobId: file?.jobId ?? null,
  };
  if (!file || file.phase === "idle") {
    return { ...base, phase: "idle", error: null, busy: false };
  }
  if (file.phase === "error") {
    return { ...base, phase: "error", error: file.error || "Ошибка", busy: false };
  }
  if (file.phase === "agent") {
    return { ...base, phase: "agent", error: null, busy: true };
  }
  // comfy
  if (!file.jobId) return { ...base, phase: "error", error: "Нет id задания", busy: false };
  const job = readJobSnapshot(file.jobId);
  if (job === "missing") {
    return { ...base, phase: "error", error: `Задание ${file.jobId} пропало из очереди`, busy: false };
  }
  if (job === null) return { ...base, phase: "queued", error: null, busy: true };
  if (job.status === "done" || job.status === "cancelled") {
    return { ...base, phase: "idle", error: null, busy: false };
  }
  if (job.status === "error") {
    return { ...base, phase: "error", error: job.error || "Ошибка ComfyUI", busy: false };
  }
  if (job.status === "running" && job.promptId) {
    return { ...base, phase: "running", error: null, busy: true };
  }
  return { ...base, phase: "queued", error: null, busy: true };
}

export class StageBusyError extends Error {
  constructor(state: StageState) {
    super(
      `Этап занят: ${PHASE_LABELS[state.phase].toLowerCase()}. Дождитесь окончания или нажмите «Отменить».`,
    );
  }
}

export function assertStageFree(shotId: string, stageId: StageId, root?: string): void {
  const state = readStageState(shotId, stageId, root);
  if (state.busy) throw new StageBusyError(state);
}
