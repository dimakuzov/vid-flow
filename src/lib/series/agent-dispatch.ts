import type { AgentProviderId } from "../contracts/agent-request";
import { defaultClaudeModel, ollamaModel } from "../agent/config";
import { abortFormatRun, isFormatRunLive, startFormatRun } from "../agent/format-runner";
import { abortAgentRun, isAgentRunLive, listLiveAgentRuns, startAgentRun } from "../agent/runner";
import { registerLoop } from "../background";
import { cancelComfyJob } from "../comfy/queue";
import { queueStageRun } from "../comfy/stage-run";
import { STAGES, type StageId } from "./constants";
import { readFormatRequest, writeFormatRequest } from "./format-request";
import { episodeRoot, listEpisodeIds, listShotIds } from "./paths";
import {
  cancelAgentRequest,
  readAgentDispatch,
  readAgentRequest,
  writeAgentDispatch,
} from "./agent-request";
import {
  AGENT_TIMEOUT_MS,
  readStageState,
  readStageStateFile,
  setError,
  setIdle,
  type StageState,
} from "./stage-state";

export const RESTARTED_ERROR = "Доска перезапущена, пока работал агент. Отправь запрос заново.";

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Агент закончил: этапы, которые запускает доска, уходят в Comfy. */
function queueAfterAgent(episodeId: string, shotId: string, stageId: StageId): void {
  const dispatch = readAgentDispatch(episodeId, shotId, stageId);
  try {
    const queued = queueStageRun(episodeId, shotId, stageId, {
      workflow: dispatch?.workflow || dispatch?.videoWorkflow,
      fromAgent: true,
      allowCloud: dispatch?.allowCloud === true,
      takes: dispatch?.takes,
    });
    if (dispatch) {
      writeAgentDispatch(episodeId, shotId, stageId, {
        ...dispatch,
        state: "queued",
        jobId: queued.id,
        error: undefined,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    const message = errorText(error, "Не удалось поставить в Comfy");
    setError(episodeId, shotId, stageId, message);
    if (dispatch) {
      writeAgentDispatch(episodeId, shotId, stageId, {
        ...dispatch,
        state: "error",
        error: message,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

/**
 * Единственное место, где фазы меняются сами по себе:
 * agent → comfy (агент поставил done) / idle (агент сам гонял Comfy) / error (запрос error, таймаут,
 * перезапуск доски во время running); pending у провайдера доски — запуск исполнителя;
 * comfy → idle (задание done) / error (задание упало или пропало).
 */
export function reconcileStage(episodeId: string, shotId: string, stageId: StageId): void {
  const file = readStageStateFile(episodeId, shotId, stageId);

  if (!file) {
    // Запросы, отправленные до появления stage_state.json.
    const dispatch = readAgentDispatch(episodeId, shotId, stageId);
    const request = readAgentRequest(episodeId, shotId, stageId);
    if (dispatch?.state === "wait" && request?.status === "done") queueAfterAgent(episodeId, shotId, stageId);
    return;
  }

  if (file.phase === "agent") {
    const request = readAgentRequest(episodeId, shotId, stageId);
    if (!request || (file.requestId && request.id !== file.requestId)) {
      setError(episodeId, shotId, stageId, "Запрос агенту пропал или заменён");
      return;
    }
    if (request.status === "cancelled") {
      setIdle(episodeId, shotId, stageId);
      return;
    }
    const provider = request.provider ?? "manual";
    // Провайдер доски ещё работает (CLI-агент мог сам поставить done раньше выхода): ждём исполнителя.
    // Таймаут режима держит исполнитель, а не этот цикл.
    if (provider !== "manual" && isAgentRunLive(episodeId, request.id)) return;
    if (request.status === "done") {
      if (file.agentRunsComfy) setIdle(episodeId, shotId, stageId);
      else queueAfterAgent(episodeId, shotId, stageId);
      return;
    }
    if (request.status === "error") {
      setError(episodeId, shotId, stageId, request.error || "Агент вернул ошибку");
      return;
    }
    if (provider !== "manual") {
      if (request.status === "running") {
        setError(episodeId, shotId, stageId, RESTARTED_ERROR);
        return;
      }
      // pending без исполнителя: отправлен до перезапуска или запуск не успел начаться.
      void startAgentRun(episodeId, shotId, stageId);
      return;
    }
    const since = Date.parse(file.since);
    if (Number.isFinite(since) && Date.now() - since > AGENT_TIMEOUT_MS) {
      const minutes = Math.round(AGENT_TIMEOUT_MS / 60000);
      setError(
        episodeId,
        shotId,
        stageId,
        `Агент не ответил за ${minutes} мин. Запрос остаётся во входящих: можно отправить заново или отменить.`,
      );
    }
    return;
  }

  if (file.phase === "comfy") {
    const state: StageState = readStageState(episodeId, shotId, stageId);
    if (state.phase === "idle") setIdle(episodeId, shotId, stageId);
    else if (state.phase === "error") setError(episodeId, shotId, stageId, state.error || "Ошибка ComfyUI");
  }
}

/**
 * Разметка сценария моделью доски: pending без исполнителя — запустить;
 * running без исполнителя (доску перезапустили) — ошибка.
 */
function reconcileFormatRequest(episodeId: string): void {
  const request = readFormatRequest(episodeRoot(episodeId));
  if (!request || (request.provider ?? "manual") === "manual") return;
  if (isFormatRunLive(episodeId)) return;
  if (request.status === "pending") void startFormatRun(episodeId);
  else if (request.status === "running") {
    writeFormatRequest({ ...request, status: "error", error: RESTARTED_ERROR, finishedAt: new Date().toISOString() });
  }
}

/** Один проход фонового цикла по всем эпизодам, а не только по открытому в шапке. */
export function reconcileAllStages(): void {
  for (const episodeId of listEpisodeIds()) {
    try {
      reconcileFormatRequest(episodeId);
    } catch {
      // format_request.json ещё пишется.
    }
    let shotIds: string[];
    try {
      shotIds = listShotIds(episodeId);
    } catch {
      continue;
    }
    for (const shotId of shotIds) {
      for (const stageId of STAGES) {
        try {
          reconcileStage(episodeId, shotId, stageId);
        } catch {
          // Файл этапа ещё пишется. Следующий проход прочитает его снова.
        }
      }
    }
  }
}

/** Кнопка «Отменить»: снимает запрос агенту и задание в очереди, возвращает этап в покой. */
export async function cancelStage(episodeId: string, shotId: string, stageId: StageId): Promise<void> {
  const file = readStageStateFile(episodeId, shotId, stageId);
  if (file?.phase === "agent" || file?.phase === "error") {
    // Сначала cancelled на диске, потом abort: исполнитель после обрыва видит отмену и ничего не пишет.
    const cancelled = cancelAgentRequest(episodeId, shotId, stageId);
    if (cancelled) abortAgentRun(episodeId, cancelled.id);
  }
  if (file?.phase === "comfy" || file?.phase === "error") {
    const ids = file.jobIds?.length ? file.jobIds : file.jobId ? [file.jobId] : [];
    for (const id of ids) await cancelComfyJob(id);
  }
  setIdle(episodeId, shotId, stageId);
}

export function startAgentDispatch(): void {
  registerLoop("agent-dispatch", 3000, reconcileAllStages);
}

/**
 * Прогон агента доски для `GET /api/agent/runs`. kind "format" — разметка сценария эпизода
 * (кнопка «Добавить»), у неё нет кадра и этапа.
 */
export interface AgentRunEntry {
  kind: "stage" | "format";
  episodeId: string;
  shotId: string | null;
  stageId: StageId | null;
  provider: AgentProviderId;
  /** Модель провайдера; без выбора в запросе — модель провайдера по умолчанию. */
  model: string | null;
  /** running — с какого времени работает, queued — с какого времени ждёт. */
  since: string;
}

export interface AgentRunsSummary {
  running: AgentRunEntry[];
  queued: AgentRunEntry[];
}

function modelOf(provider: AgentProviderId, model: string | undefined | null): string | null {
  if (model) return model;
  if (provider === "claude") return defaultClaudeModel();
  if (provider === "ollama") return ollamaModel();
  return null;
}

function bySince(a: AgentRunEntry, b: AgentRunEntry): number {
  return a.since.localeCompare(b.since);
}

/**
 * Агенты доски по всем эпизодам. running — живые прогоны этого процесса (исполнитель и разметка).
 * queued — pending у провайдера доски, которые фоновый цикл запустит, когда освободится место.
 * Ручной режим сюда не входит: его исполняет агент в чате, а не доска.
 */
export function listAgentRuns(): AgentRunsSummary {
  const running: AgentRunEntry[] = listLiveAgentRuns().map((run) => ({
    kind: "stage",
    episodeId: run.episodeId,
    shotId: run.shotId,
    stageId: run.stageId,
    provider: run.provider,
    model: modelOf(run.provider, run.model),
    since: run.startedAt,
  }));
  const queued: AgentRunEntry[] = [];

  for (const episodeId of listEpisodeIds()) {
    try {
      const format = readFormatRequest(episodeRoot(episodeId));
      const provider = format?.provider ?? "manual";
      if (format && provider !== "manual") {
        const live = isFormatRunLive(episodeId);
        const entry: AgentRunEntry = {
          kind: "format",
          episodeId,
          shotId: null,
          stageId: null,
          provider,
          model: modelOf(provider, format.model),
          since: format.startedAt || format.createdAt,
        };
        if (live && format.status === "running") running.push(entry);
        else if (!live && format.status === "pending") queued.push({ ...entry, since: format.createdAt });
      }
    } catch {
      // format_request.json ещё пишется.
    }

    let shotIds: string[];
    try {
      shotIds = listShotIds(episodeId);
    } catch {
      continue;
    }
    for (const shotId of shotIds) {
      for (const stageId of STAGES) {
        try {
          const request = readAgentRequest(episodeId, shotId, stageId);
          const provider = request?.provider ?? "manual";
          if (!request || request.status !== "pending" || provider === "manual") continue;
          if (isAgentRunLive(episodeId, request.id)) continue;
          // Цикл запускает pending только у этапа в фазе agent с этим же запросом.
          const file = readStageStateFile(episodeId, shotId, stageId);
          if (file?.phase !== "agent" || (file.requestId && file.requestId !== request.id)) continue;
          queued.push({
            kind: "stage",
            episodeId,
            shotId,
            stageId,
            provider,
            model: modelOf(provider, request.model),
            since: request.createdAt,
          });
        } catch {
          // Файл этапа ещё пишется.
        }
      }
    }
  }

  return { running: running.sort(bySince), queued: queued.sort(bySince) };
}

export type AgentRunTarget =
  | { episodeId: string; shotId: string; stageId: StageId }
  | { episodeId: string; shotId: string }
  | { episodeId: string; format: true };

function matches(entry: AgentRunEntry, target: AgentRunTarget | "all"): boolean {
  if (target === "all") return true;
  if (entry.episodeId !== target.episodeId) return false;
  if ("format" in target) return entry.kind === "format";
  if (entry.kind !== "stage" || entry.shotId !== target.shotId) return false;
  return !("stageId" in target) || entry.stageId === target.stageId;
}

/**
 * Остановка из CLI и меню агента кадра (`POST /api/agent/runs/stop`): для этапа — то же, что
 * «Отменить» на этапе, для разметки сценария — `abortFormatRun`. Один прогон, все прогоны кадра
 * или все работающие и ждущие.
 * Возвращает остановленные прогоны; цель без прогона агента — пустой список, ничего не трогается.
 */
export async function stopAgentRuns(target: AgentRunTarget | "all"): Promise<AgentRunEntry[]> {
  const { running, queued } = listAgentRuns();
  const stopped: AgentRunEntry[] = [];
  for (const entry of [...running, ...queued]) {
    if (!matches(entry, target)) continue;
    if (entry.kind === "format") {
      if (abortFormatRun(entry.episodeId)) stopped.push(entry);
      continue;
    }
    if (!entry.shotId || !entry.stageId) continue;
    await cancelStage(entry.episodeId, entry.shotId, entry.stageId);
    stopped.push(entry);
  }
  return stopped;
}
