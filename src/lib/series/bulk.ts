import path from "path";
import { listWorkflowChoices } from "../comfy/workflows";
import type { AgentProviderId } from "../contracts/agent-request";
import { submitAgentRequest } from "./agent-request";
import { STAGE_LABELS, STAGES, type StageId } from "./constants";
import { readTextIfExists } from "./media";
import { listShotIds, stageDir } from "./paths";
import { readShotMeta, type ShotMeta } from "./shot-meta";
import { PHASE_LABELS, readStageState } from "./stage-state";
import { deriveStageStatus } from "./status";

/*
 * Действия «для всех кадров» над таблицей: каждый кадр получает запрос агенту, как будто
 * пользователь нажал «Отправить агенту» на нужном этапе. Дальше всё как обычно: агент пишет
 * prompt.md, доска ставит прогон в ComfyUI (или агент делает этап сам — персонажи).
 * Сколько агентов идёт одновременно, решает исполнитель (FRAMEBOARD_AGENT_PARALLEL).
 */

/** Сообщение агенту от массового запуска: пользователь ничего не писал. */
export const BULK_MESSAGE =
  "Подготовь этот этап по действию кадра (shot.md) и плейбуку модели. Если текущий prompt.md уже подходит, оставь его как есть.";

export interface BulkItem {
  shotId: string;
  stageId: StageId | null;
}

export interface BulkSkip extends BulkItem {
  reason: string;
}

export interface BulkResult {
  started: BulkItem[];
  skipped: BulkSkip[];
}

export interface BulkOptions {
  /** manual | ollama | claude. Нет — FRAMEBOARD_AGENT_PROVIDER. */
  provider?: AgentProviderId | string;
  /** Запускать и там, где этап уже утверждён. По умолчанию нет. */
  includeApproved?: boolean;
}

/** Этап не нужен кадру: персонажей или локации у него нет (первый кадр собирается сразу). */
function stageNotNeeded(meta: ShotMeta, stageId: StageId): string | null {
  if (stageId === "characters" && !meta.characters.length) return "в кадре нет персонажей";
  if (stageId === "location" && !meta.location.trim()) return "у кадра нет локации";
  return null;
}

/** Почему этап этого кадра сейчас не запустить. null — можно. */
function blocked(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  meta: ShotMeta,
  includeApproved: boolean,
): string | null {
  const notNeeded = stageNotNeeded(meta, stageId);
  if (notNeeded) return notNeeded;
  const state = readStageState(episodeId, shotId, stageId);
  if (state.busy) return `этап занят: ${PHASE_LABELS[state.phase].toLowerCase()}`;
  if (!includeApproved && deriveStageStatus(episodeId, shotId, stageId, meta.characters) === "approved") {
    return "уже утверждено";
  }
  const choices = listWorkflowChoices(episodeId, shotId, stageId);
  // Этап без воркфлоу доски (персонажи) делает агент сам — здесь не блокируем.
  if (choices.length && !choices.some((choice) => choice.available)) {
    const missing = choices.find((choice) => choice.isDefault)?.missing ?? choices[0].missing;
    return `не хватает: ${missing.join(", ")}`;
  }
  return null;
}

function sendToAgent(episodeId: string, shotId: string, stageId: StageId, provider?: string): void {
  const dir = stageDir(episodeId, shotId, stageId);
  // Документы этапа уходят как есть: массовый запуск ничего в них не меняет.
  submitAgentRequest({
    episodeId,
    shotId,
    stageId,
    message: BULK_MESSAGE,
    prompt: readTextIfExists(path.join(dir, "prompt.md")),
    refsNote: readTextIfExists(path.join(dir, "refs.md")),
    workflowNote: readTextIfExists(path.join(dir, "workflow.md")),
    provider,
  });
}

function tryStart(
  result: BulkResult,
  episodeId: string,
  shotId: string,
  stageId: StageId,
  provider: string | undefined,
): void {
  try {
    sendToAgent(episodeId, shotId, stageId, provider);
    result.started.push({ shotId, stageId });
  } catch (error) {
    result.skipped.push({ shotId, stageId, reason: error instanceof Error ? error.message : "не запустилось" });
  }
}

/** Кнопка над столбцом этапа: этот этап на всех кадрах эпизода. */
export function runStageForAllShots(episodeId: string, stageId: StageId, options: BulkOptions = {}): BulkResult {
  const result: BulkResult = { started: [], skipped: [] };
  for (const shotId of listShotIds(episodeId)) {
    const meta = readShotMeta(episodeId, shotId);
    const reason = blocked(episodeId, shotId, stageId, meta, options.includeApproved === true);
    if (reason) result.skipped.push({ shotId, stageId, reason });
    else tryStart(result, episodeId, shotId, stageId, options.provider);
  }
  return result;
}

/**
 * Первый этап кадра, который ещё не утверждён и нужен этому кадру. null — кадр готов.
 * Этапы идут по порядку таблицы: следующий начинается, когда предыдущий утверждён.
 */
export function nextStage(episodeId: string, shotId: string, meta: ShotMeta): StageId | null {
  for (const stageId of STAGES) {
    if (stageNotNeeded(meta, stageId)) continue;
    if (deriveStageStatus(episodeId, shotId, stageId, meta.characters) !== "approved") return stageId;
  }
  return null;
}

/** Кнопка над столбцом «Кадр»: каждому кадру — агент на его следующий этап. */
export function runNextStageForAllShots(episodeId: string, options: BulkOptions = {}): BulkResult {
  const result: BulkResult = { started: [], skipped: [] };
  for (const shotId of listShotIds(episodeId)) {
    const meta = readShotMeta(episodeId, shotId);
    const stageId = nextStage(episodeId, shotId, meta);
    if (!stageId) {
      result.skipped.push({ shotId, stageId: null, reason: "все этапы утверждены" });
      continue;
    }
    const reason = blocked(episodeId, shotId, stageId, meta, false);
    if (reason) result.skipped.push({ shotId, stageId, reason: `${STAGE_LABELS[stageId]}: ${reason}` });
    else tryStart(result, episodeId, shotId, stageId, options.provider);
  }
  return result;
}
