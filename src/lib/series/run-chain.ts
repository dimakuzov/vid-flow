import fs from "fs";
import path from "path";
import type { StageId } from "./constants";
import { submitAgentRequest } from "./agent-request";
import { readTextIfExists } from "./media";
import { stageDir } from "./paths";

/*
 * Цепочка прогонов этапа: «▶ Все кадры» на эскизе видео гонит сначала LTX, потом MiniMax.
 * Первый воркфлоу уходит обычным запросом агенту, остальные ждут в `run_chain.json` папки этапа.
 * Прогон закончился в ComfyUI — доска отправляет агенту следующий воркфлоу: он переписывает
 * prompt.md под него, и доска ставит второй прогон. Ошибка прогона или «Отменить» обрывают цепочку.
 * Пишет только доска.
 */

const FILE = "run_chain.json";

/** Воркфлоу этапа для «▶ Все кадры» по порядку. Нет этапа — один прогон, как раньше. */
export const BULK_CHAINS: Partial<Record<StageId, string[]>> = {
  video_preview: ["video_ltx", "video_minimax"],
};

export interface RunChain {
  /** Воркфлоу, которые ещё впереди, по порядку. */
  workflows: string[];
  provider?: string;
  model?: string;
  createdAt: string;
}

function chainPath(episodeId: string, shotId: string, stageId: StageId): string {
  return path.join(stageDir(episodeId, shotId, stageId), FILE);
}

export function readRunChain(episodeId: string, shotId: string, stageId: StageId): RunChain | null {
  try {
    const data = JSON.parse(fs.readFileSync(chainPath(episodeId, shotId, stageId), "utf8")) as RunChain;
    return Array.isArray(data.workflows) && data.workflows.length ? data : null;
  } catch {
    return null;
  }
}

export function writeRunChain(episodeId: string, shotId: string, stageId: StageId, chain: RunChain | null): void {
  const file = chainPath(episodeId, shotId, stageId);
  if (!chain || !chain.workflows.length) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.writeFileSync(file, JSON.stringify(chain, null, 2) + "\n", "utf8");
}

/** Сообщение агенту на следующем шаге цепочки: пользователь его не писал. */
export function chainMessage(workflow: string): string {
  return `Перепиши prompt.md под воркфлоу ${workflow} по его плейбуку. Действие, его порядок и время, реплики и все замечания пользователя сохрани.`;
}

/**
 * Прогон этапа закончился: следующий воркфлоу цепочки — агенту. Ничего не ждёт — ничего не делает.
 * Не получилось отправить — цепочка снимается, ошибка в консоли.
 */
export function continueRunChain(episodeId: string, shotId: string, stageId: StageId): void {
  const chain = readRunChain(episodeId, shotId, stageId);
  if (!chain) return;
  const [next, ...rest] = chain.workflows;
  writeRunChain(episodeId, shotId, stageId, rest.length ? { ...chain, workflows: rest } : null);
  const dir = stageDir(episodeId, shotId, stageId);
  try {
    submitAgentRequest({
      episodeId,
      shotId,
      stageId,
      message: chainMessage(next),
      prompt: readTextIfExists(path.join(dir, "prompt.md")),
      refsNote: readTextIfExists(path.join(dir, "refs.md")),
      workflowNote: readTextIfExists(path.join(dir, "workflow.md")),
      workflow: next,
      provider: chain.provider,
      model: chain.model,
      auto: true,
    });
  } catch (error) {
    writeRunChain(episodeId, shotId, stageId, null);
    console.warn("[frameboard] цепочка прогонов:", shotId, stageId, error instanceof Error ? error.message : error);
  }
}
