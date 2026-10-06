import type { AgentRequestFile, AgentResult } from "../contracts/agent-request";
import type { StageId } from "../series/constants";
import { updateStageDocs } from "../series/mutations";
import { formatMinutes, modeTimeoutMs } from "./config";
import { appendRunLog, captureBaseline, readAgentRequest, writeAgentRequest } from "./files";
import { cleanPromptText, getAgentProvider } from "./providers";
import { buildAgentTask } from "./task";

/*
 * Исполнитель запросов агенту: pending → running → done | error (docs/contracts/agent-request.md).
 * Живые прогоны хранятся в памяти процесса доски. После перезапуска их нет — фоновый цикл
 * переводит такой `running` в error.
 */

interface LiveRun {
  requestId: string;
  controller: AbortController;
  promise: Promise<void>;
  cancelled: boolean;
}

class AgentTimeout extends Error {
  constructor(ms: number) {
    super(`Агент не ответил за ${formatMinutes(ms)}`);
  }
}

class AgentCancelled extends Error {
  constructor() {
    super("Запрос отменён");
  }
}

const KEY = "__frameboardAgentRuns";

/** Общая карта на процесс: переживает горячую перезагрузку модуля. */
function liveRuns(): Map<string, LiveRun> {
  const g = globalThis as typeof globalThis & { [KEY]?: Map<string, LiveRun> };
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY]!;
}

function runKey(episodeId: string, requestId: string): string {
  return `${episodeId}/${requestId}`;
}

export function isAgentRunLive(episodeId: string, requestId: string): boolean {
  return liveRuns().has(runKey(episodeId, requestId));
}

/** Промис живого прогона (тесты, ожидание). null — в этом процессе прогона нет. */
export function agentRunPromise(episodeId: string, requestId: string): Promise<void> | null {
  return liveRuns().get(runKey(episodeId, requestId))?.promise ?? null;
}

/** «Отменить»: обрывает HTTP-запрос или убивает процесс. Результат после этого не пишется. */
export function abortAgentRun(episodeId: string, requestId: string): boolean {
  const run = liveRuns().get(runKey(episodeId, requestId));
  if (!run) return false;
  run.cancelled = true;
  run.controller.abort(new AgentCancelled());
  return true;
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "Программа агента не найдена";
    return error.message;
  }
  return "Агент упал";
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** Сам запрос всё ещё этот и не отменён: результат можно писать. */
function stillCurrent(request: AgentRequestFile): AgentRequestFile | null {
  const current = readAgentRequest(request.episodeId, request.shotId, request.stageId);
  if (!current || current.id !== request.id) return null;
  if (current.status === "cancelled") return null;
  return current;
}

function writeError(request: AgentRequestFile, error: string): void {
  writeAgentRequest({ ...request, status: "error", error, finishedAt: new Date().toISOString() });
}

function applyResult(request: AgentRequestFile, result: AgentResult): void {
  const { episodeId, shotId, stageId } = request;
  const mode = request.mode;
  const now = new Date().toISOString();

  if (mode === "agent" && result.log?.trim()) {
    appendRunLog(
      episodeId,
      shotId,
      stageId,
      `\n## ${now} · ${request.provider} · ${result.status}\n\n${result.log.trim()}\n`,
    );
  }

  if (result.status === "error") {
    writeError(request, result.error || "Агент вернул ошибку");
    return;
  }

  if (mode === "text") {
    const prompt = cleanPromptText(result.prompt ?? "");
    if (!prompt) {
      writeError(request, "Агент вернул пустой промпт");
      return;
    }
    // Через updateStageDocs: прошлая версия prompt.md уходит в prompt_history.json.
    updateStageDocs({ episodeId, shotId, stageId, prompt: `${prompt}\n` });
    captureBaseline(episodeId, shotId, stageId);
  }

  writeAgentRequest({
    ...request,
    status: "done",
    error: undefined,
    finishedAt: now,
    suggestedWorkflow: result.suggestedWorkflow ?? request.suggestedWorkflow,
  });
}

async function execute(request: AgentRequestFile, run: LiveRun): Promise<void> {
  const mode = request.mode!;
  const provider = getAgentProvider(request.provider!);
  const timeoutMs = modeTimeoutMs(mode);
  const signal = run.controller.signal;
  const timer = setTimeout(() => run.controller.abort(new AgentTimeout(timeoutMs)), timeoutMs);

  let result: AgentResult;
  try {
    const task = buildAgentTask(request, mode, timeoutMs);
    // race: провайдер, который не слушает signal, всё равно не держит запрос дольше таймаута.
    result = await Promise.race([provider.run(task, signal), abortPromise(signal)]);
  } catch (error) {
    result = { status: "error", error: errorText(signal.aborted ? signal.reason : error) };
  } finally {
    clearTimeout(timer);
  }

  if (run.cancelled) return;
  const current = stillCurrent(request);
  if (!current || current.status !== "running") return;
  applyResult(current, result);
}

/**
 * Запускает провайдера для `pending`-запроса этапа в фоне. null — запускать нечего
 * (нет запроса, он не pending, ручной режим или уже идёт в этом процессе).
 */
export function startAgentRun(episodeId: string, shotId: string, stageId: StageId): Promise<void> | null {
  const request = readAgentRequest(episodeId, shotId, stageId);
  if (!request || request.status !== "pending") return null;
  const providerId = request.provider ?? "manual";
  const mode = request.mode ?? "manual";
  if (providerId === "manual" || mode === "manual") return null;
  if (isAgentRunLive(episodeId, request.id)) return null;

  const provider = getAgentProvider(providerId);
  if (!provider.modes.includes(mode)) {
    writeError(request, `${provider.label} не умеет режим ${mode}. Выбери другого провайдера.`);
    return null;
  }

  const running: AgentRequestFile = {
    ...request,
    provider: providerId,
    mode,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  writeAgentRequest(running);

  const key = runKey(episodeId, request.id);
  const run: LiveRun = {
    requestId: request.id,
    controller: new AbortController(),
    cancelled: false,
    promise: Promise.resolve(),
  };
  liveRuns().set(key, run);
  run.promise = execute(running, run)
    .catch((error) => {
      console.error("[frameboard] исполнитель агента:", error);
      if (!run.cancelled && stillCurrent(running)?.status === "running") writeError(running, errorText(error));
    })
    .finally(() => {
      if (liveRuns().get(key) === run) liveRuns().delete(key);
    });
  return run.promise;
}
