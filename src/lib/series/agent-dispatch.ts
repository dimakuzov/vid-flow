import { registerLoop } from "../background";
import { cancelComfyJob } from "../comfy/queue";
import { queueStageRun } from "../comfy/stage-run";
import { STAGES, type StageId } from "./constants";
import { listEpisodeIds, listShotIds } from "./paths";
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
 * agent → comfy (агент поставил done) / idle (агент сам гонял Comfy) / error (таймаут),
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
    if (request.status === "done") {
      if (file.agentRunsComfy) setIdle(episodeId, shotId, stageId);
      else queueAfterAgent(episodeId, shotId, stageId);
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

/** Один проход фонового цикла по всем эпизодам, а не только по открытому в шапке. */
export function reconcileAllStages(): void {
  for (const episodeId of listEpisodeIds()) {
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
  if (file?.phase === "agent" || file?.phase === "error") cancelAgentRequest(episodeId, shotId, stageId);
  if (file?.jobId && (file.phase === "comfy" || file.phase === "error")) {
    await cancelComfyJob(file.jobId);
  }
  setIdle(episodeId, shotId, stageId);
}

export function startAgentDispatch(): void {
  registerLoop("agent-dispatch", 3000, reconcileAllStages);
}
