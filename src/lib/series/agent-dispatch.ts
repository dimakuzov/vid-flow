import { cancelComfyJob } from "../comfy/queue";
import { queueStageRun } from "../comfy/stage-run";
import { STAGES, type StageId } from "./constants";
import {
  cancelAgentRequest,
  listSeriesShotIds,
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

let ticking = false;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Агент закончил: этапы, которые запускает доска, уходят в Comfy. */
function queueAfterAgent(shotId: string, stageId: StageId): void {
  const dispatch = readAgentDispatch(shotId, stageId);
  try {
    const queued = queueStageRun(shotId, stageId, {
      videoWorkflow: dispatch?.videoWorkflow === "flf" ? "flf" : "i2v",
      fromAgent: true,
    });
    if (dispatch) {
      writeAgentDispatch(shotId, stageId, {
        ...dispatch,
        state: "queued",
        jobId: queued.id,
        error: undefined,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    const message = errorText(error, "Не удалось поставить в Comfy");
    setError(shotId, stageId, message);
    if (dispatch) {
      writeAgentDispatch(shotId, stageId, {
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
export function reconcileStage(shotId: string, stageId: StageId): void {
  const file = readStageStateFile(shotId, stageId);

  if (!file) {
    // Запросы, отправленные до появления stage_state.json.
    const dispatch = readAgentDispatch(shotId, stageId);
    const request = readAgentRequest(shotId, stageId);
    if (dispatch?.state === "wait" && request?.status === "done") queueAfterAgent(shotId, stageId);
    return;
  }

  if (file.phase === "agent") {
    const request = readAgentRequest(shotId, stageId);
    if (!request || (file.requestId && request.id !== file.requestId)) {
      setError(shotId, stageId, "Запрос агенту пропал или заменён");
      return;
    }
    if (request.status === "cancelled") {
      setIdle(shotId, stageId);
      return;
    }
    if (request.status === "done") {
      if (file.agentRunsComfy) setIdle(shotId, stageId);
      else queueAfterAgent(shotId, stageId);
      return;
    }
    const since = Date.parse(file.since);
    if (Number.isFinite(since) && Date.now() - since > AGENT_TIMEOUT_MS) {
      const minutes = Math.round(AGENT_TIMEOUT_MS / 60000);
      setError(
        shotId,
        stageId,
        `Агент не ответил за ${minutes} мин. Запрос остаётся во входящих: можно отправить заново или отменить.`,
      );
    }
    return;
  }

  if (file.phase === "comfy") {
    const state: StageState = readStageState(shotId, stageId);
    if (state.phase === "idle") setIdle(shotId, stageId);
    else if (state.phase === "error") setError(shotId, stageId, state.error || "Ошибка ComfyUI");
  }
}

function tick(): void {
  let shotIds: string[];
  try {
    shotIds = listSeriesShotIds();
  } catch {
    return;
  }
  for (const shotId of shotIds) {
    for (const stageId of STAGES) {
      try {
        reconcileStage(shotId, stageId);
      } catch {
        // Файл этапа ещё пишется. Следующий проход прочитает его снова.
      }
    }
  }
}

/** Кнопка «Отменить»: снимает запрос агенту и задание в очереди, возвращает этап в покой. */
export async function cancelStage(shotId: string, stageId: StageId): Promise<void> {
  const file = readStageStateFile(shotId, stageId);
  if (file?.phase === "agent" || file?.phase === "error") cancelAgentRequest(shotId, stageId);
  if (file?.jobId && (file.phase === "comfy" || file.phase === "error")) {
    await cancelComfyJob(file.jobId);
  }
  setIdle(shotId, stageId);
}

export function startAgentDispatch(): void {
  const g = globalThis as { __frameboardAgentDispatch?: boolean };
  if (g.__frameboardAgentDispatch) return;
  g.__frameboardAgentDispatch = true;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    try {
      tick();
    } finally {
      ticking = false;
    }
  }, 3000);
}
