import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { AgentRequestFile, RefFingerprint } from "../contracts/agent-request";
import type { StageId } from "../series/constants";
import { readTextIfExists, writeText } from "../series/media";
import { stageDir } from "../series/paths";

/*
 * Файлы запроса в папке этапа (docs/contracts/agent-request.md, «Файлы запроса»).
 * Отдельный модуль, чтобы исполнитель и series/agent-request.ts не импортировали друг друга.
 */

export const REQUEST_JSON = "agent_request.json";
export const LLM_TASK = "llm_task.md";
export const DISPATCH_FILE = "agent_dispatch.json";
export const BASELINE_FILE = "agent_baseline.json";
export const TOUCH_FILE = "agent_touch.json";
export const RUN_LOG = "run_log.md";

export type AgentComfyState = "wait" | "queued" | "error" | "agent" | "cancelled";

export interface AgentDispatch {
  requestId: string;
  state: AgentComfyState;
  /** id манифеста (или старое имя), с которым доска поставит прогон после done. Нет — выбор этапа. */
  workflow?: string;
  /** Старое поле: i2v / flf. Читается, если нет workflow. */
  videoWorkflow?: string;
  /** Пользователь разрешил платный запуск в Comfy Cloud после ответа агента (один запуск). */
  allowCloud?: boolean;
  /** Сколько файлов поставить после ответа агента. Нет — один. Не запоминается между заходами. */
  takes?: number;
  jobId?: string;
  error?: string;
  updatedAt: string;
}

export interface AgentBaseline {
  capturedAt: string;
  prompt: string;
  refsNote: string;
  workflowNote: string;
  refs: RefFingerprint[];
  /** Воркфлоу, под который агент доски написал этот prompt.md. Нет — неизвестно (ручной агент, старые файлы). */
  workflow?: string;
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, data: unknown): void {
  writeText(file, JSON.stringify(data, null, 2) + "\n");
}

export function readAgentRequest(episodeId: string, shotId: string, stageId: StageId): AgentRequestFile | null {
  return readJson<AgentRequestFile>(path.join(stageDir(episodeId, shotId, stageId), REQUEST_JSON));
}

export function writeAgentRequest(request: AgentRequestFile): void {
  writeJson(path.join(stageDir(request.episodeId, request.shotId, request.stageId), REQUEST_JSON), request);
}

export function readAgentDispatch(episodeId: string, shotId: string, stageId: StageId): AgentDispatch | null {
  return readJson<AgentDispatch>(path.join(stageDir(episodeId, shotId, stageId), DISPATCH_FILE));
}

export function writeAgentDispatch(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  dispatch: AgentDispatch,
): void {
  writeJson(path.join(stageDir(episodeId, shotId, stageId), DISPATCH_FILE), dispatch);
}

export function readBaseline(episodeId: string, shotId: string, stageId: StageId): AgentBaseline | null {
  return readJson<AgentBaseline>(path.join(stageDir(episodeId, shotId, stageId), BASELINE_FILE));
}

export function readTouch(episodeId: string, shotId: string, stageId: StageId): boolean {
  const data = readJson<{ refsTouchedByUser?: boolean }>(
    path.join(stageDir(episodeId, shotId, stageId), TOUCH_FILE),
  );
  return data?.refsTouchedByUser === true;
}

export function fingerprintRefs(episodeId: string, shotId: string, stageId: StageId): RefFingerprint[] {
  const dir = path.join(stageDir(episodeId, shotId, stageId), "refs");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => fs.statSync(path.join(dir, name)).isFile())
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const bytes = fs.readFileSync(path.join(dir, name));
      return {
        name,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      };
    });
}

/** Снимок после прохода агента: с ним следующий запрос сравнивает правки пользователя. */
export function captureBaseline(episodeId: string, shotId: string, stageId: StageId, workflow?: string): void {
  const dir = stageDir(episodeId, shotId, stageId);
  const baseline: AgentBaseline = {
    capturedAt: new Date().toISOString(),
    prompt: readTextIfExists(path.join(dir, "prompt.md")),
    refsNote: readTextIfExists(path.join(dir, "refs.md")),
    workflowNote: readTextIfExists(path.join(dir, "workflow.md")),
    refs: fingerprintRefs(episodeId, shotId, stageId),
    ...(workflow ? { workflow } : {}),
  };
  writeJson(path.join(dir, BASELINE_FILE), baseline);
  writeJson(path.join(dir, TOUCH_FILE), { refsTouchedByUser: false });
}

export function appendRunLog(episodeId: string, shotId: string, stageId: StageId, text: string): void {
  const file = path.join(stageDir(episodeId, shotId, stageId), RUN_LOG);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}
