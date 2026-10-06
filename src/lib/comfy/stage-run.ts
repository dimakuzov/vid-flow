import path from "path";
import type { StageId } from "../series/constants";
import { stageDir, toPosix } from "../series/paths";
import { assertStageFree, readStageStateFile, writeStageState } from "../series/stage-state";
import { readRunSettings } from "../series/run-settings";
import { buildPrompt } from "./binding";
import { enqueueComfyJob, startComfyQueue } from "./queue";
import { requireStageBinding, resolveWorkflowId } from "./workflows";

function relativeToCwd(absolute: string): string {
  return toPosix(path.relative(process.cwd(), absolute));
}

/**
 * Ставит прогон этапа в очередь по манифесту графа (docs/contracts/graph-binding.md).
 * workflow — id манифеста или старое имя (`i2v`, `flf`); пусто — выбор этапа (run_settings.json),
 * иначе вариант по умолчанию.
 */
export function queueStageRun(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  options?: { workflow?: string | null; fromAgent?: boolean },
): { id: string; message: string } {
  // Ручной запуск закрыт, пока идёт операция. Из цикла после ответа агента — разрешён.
  if (!options?.fromAgent) assertStageFree(episodeId, shotId, stageId);
  const workflow = resolveWorkflowId(
    episodeId,
    shotId,
    stageId,
    options?.workflow || readRunSettings(episodeId, shotId, stageId).workflow,
  );
  if (!workflow) {
    throw new Error(
      `У этапа ${stageId} нет воркфлоу доски (манифеста в playbooks/workflows/comfy/), доска его не запускает. Прогон делает агент по плейбуку этапа.`,
    );
  }
  const { binding, graph } = requireStageBinding(stageId, workflow);
  const built = buildPrompt(binding, graph, { episodeId, shotId, stageId });
  const job = enqueueComfyJob({
    id: `${shotId}-${binding.id}-${Date.now()}`,
    status: "pending",
    episodeId,
    shotId,
    stageId,
    workflow: binding.id,
    prompt: built.prompt,
    uploads: built.uploads.map((upload) => ({ path: relativeToCwd(upload.path), filename: upload.filename })),
    saveTo: relativeToCwd(path.join(stageDir(episodeId, shotId, stageId), "output")),
  });
  const previous = readStageStateFile(episodeId, shotId, stageId);
  writeStageState(episodeId, shotId, stageId, {
    phase: "comfy",
    jobId: job.id,
    requestId: options?.fromAgent ? previous?.requestId : undefined,
  });
  startComfyQueue();
  return {
    id: job.id,
    message: `В очереди Comfy: ${job.id}. Прогон идёт там, файлы появятся в output/.`,
  };
}
