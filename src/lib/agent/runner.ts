import type { AgentRequestFile, AgentResult, AgentUsage } from "../contracts/agent-request";
import type { StageId } from "../series/constants";
import { updateStageDocs } from "../series/mutations";
import type { AgentProviderId } from "../contracts/agent-request";
import { formatMinutes, modeTimeoutMs, providerParallel } from "./config";
import { appendRunLog, captureBaseline, readAgentRequest, writeAgentRequest } from "./files";
import { cleanPromptText, getAgentProvider } from "./providers";
import { buildAgentTask, selectedWorkflow } from "./task";
import { stageUsesContext } from "../series/descriptions";
import { ensureShotAction } from "../series/shot-action";

/*
 * Исполнитель запросов агенту: pending → running → done | error (docs/contracts/agent-request.md).
 * Живые прогоны хранятся в памяти процесса доски. После перезапуска их нет — фоновый цикл
 * переводит такой `running` в error.
 */

interface LiveRun {
  requestId: string;
  episodeId: string;
  shotId: string;
  stageId: StageId;
  provider: AgentProviderId;
  model: string | null;
  startedAt: string;
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

/** Сколько запросов этого провайдера сейчас идут в процессе доски. */
export function liveRunCount(provider: AgentProviderId): number {
  let count = 0;
  for (const run of liveRuns().values()) if (run.provider === provider) count += 1;
  return count;
}

/** Живой прогон для списка `GET /api/agent/runs`. */
export interface LiveAgentRun {
  requestId: string;
  episodeId: string;
  shotId: string;
  stageId: StageId;
  provider: AgentProviderId;
  model: string | null;
  startedAt: string;
}

/** Все прогоны, которые сейчас идут в процессе доски (без отменённых), по времени запуска. */
export function listLiveAgentRuns(): LiveAgentRun[] {
  return [...liveRuns().values()]
    .filter((run) => !run.cancelled)
    .map(({ requestId, episodeId, shotId, stageId, provider, model, startedAt }) => ({
      requestId,
      episodeId,
      shotId,
      stageId,
      provider,
      model,
      startedAt,
    }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
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

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} с`;
}

/** Строки расхода для run_log.md: токены, оценка стоимости, время (всего и у модели), ходы. */
export function formatUsage(usage: AgentUsage): string {
  const lines: string[] = [];
  const tokens: string[] = [];
  if (usage.inputTokens != null) tokens.push(`вход ${usage.inputTokens}`);
  if (usage.cacheWriteTokens) tokens.push(`запись в кэш ${usage.cacheWriteTokens}`);
  if (usage.cacheReadTokens) tokens.push(`из кэша ${usage.cacheReadTokens}`);
  if (usage.outputTokens != null) tokens.push(`выход ${usage.outputTokens}`);
  if (tokens.length) lines.push(`- токены: ${tokens.join(", ")}`);
  if (usage.costUsd != null) lines.push(`- стоимость по ценам API: $${usage.costUsd.toFixed(4)}`);
  const time: string[] = [];
  if (usage.durationMs != null) time.push(`всего ${seconds(usage.durationMs)}`);
  if (usage.apiDurationMs != null) time.push(`ответ модели ${seconds(usage.apiDurationMs)}`);
  if (usage.durationMs != null && usage.apiDurationMs != null) {
    time.push(`запуск и прочее ${seconds(Math.max(0, usage.durationMs - usage.apiDurationMs))}`);
  }
  if (time.length) lines.push(`- время: ${time.join(", ")}`);
  if (usage.turns != null) lines.push(`- ходов: ${usage.turns}`);
  return lines.join("\n");
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

function applyResult(started: AgentRequestFile, result: AgentResult): void {
  const request: AgentRequestFile = result.usage ? { ...started, usage: result.usage } : started;
  const { episodeId, shotId, stageId } = request;
  const mode = request.mode;
  const now = new Date().toISOString();

  const agentLog = mode === "agent" && result.log?.trim() ? `\n\n${result.log.trim()}` : "";
  if (agentLog || result.usage) {
    const model = request.model ? ` · ${request.model}` : "";
    const usage = result.usage ? `\n\n${formatUsage(result.usage)}` : "";
    appendRunLog(
      episodeId,
      shotId,
      stageId,
      `\n## ${now} · ${request.provider}${model} · ${mode} · ${result.status}${usage}${agentLog}\n`,
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
    captureBaseline(episodeId, shotId, stageId, selectedWorkflow(episodeId, shotId, stageId)?.id);
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
    // Первый кадр и видео: модель смотрит утверждённые картинки и приводит действие кадра к ним.
    // Не вышло — агент работает с тем, что уже есть.
    if (stageUsesContext(request.stageId)) {
      await Promise.race([ensureShotAction(request.episodeId, request.shotId, signal), abortPromise(signal)]);
    }
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
  // Все места заняты: запрос остаётся pending, фоновый цикл запустит его, когда место освободится.
  if (liveRunCount(providerId) >= providerParallel(providerId)) return null;

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
    episodeId,
    shotId,
    stageId,
    provider: providerId,
    model: request.model ?? null,
    startedAt: running.startedAt!,
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
