import { queueStageRun } from "../comfy/stage-run";
import { STAGES } from "./constants";
import {
  listSeriesShotIds,
  readAgentDispatch,
  readAgentRequest,
  writeAgentDispatch,
} from "./agent-request";

let ticking = false;

function dispatchFinishedAgentRequests(): void {
  let shotIds: string[];
  try {
    shotIds = listSeriesShotIds();
  } catch {
    return;
  }
  for (const shotId of shotIds) {
    for (const stageId of STAGES) {
      const dispatch = readAgentDispatch(shotId, stageId);
      if (!dispatch || dispatch.state !== "wait") continue;
      const request = readAgentRequest(shotId, stageId);
      if (!request || request.status !== "done") continue;
      try {
        const queued = queueStageRun(shotId, stageId, {
          videoWorkflow: dispatch.videoWorkflow === "flf" ? "flf" : "i2v",
        });
        writeAgentDispatch(shotId, stageId, {
          ...dispatch,
          state: "queued",
          jobId: queued.id,
          error: undefined,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        writeAgentDispatch(shotId, stageId, {
          ...dispatch,
          state: "error",
          error: error instanceof Error ? error.message : "Не удалось поставить в Comfy",
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }
}

export function startAgentDispatch(): void {
  const g = globalThis as { __frameboardAgentDispatch?: boolean };
  if (g.__frameboardAgentDispatch) return;
  g.__frameboardAgentDispatch = true;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    try {
      dispatchFinishedAgentRequests();
    } finally {
      ticking = false;
    }
  }, 3000);
}
