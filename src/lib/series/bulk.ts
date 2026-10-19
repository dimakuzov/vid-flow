import path from "path";
import { listWorkflowChoices } from "../comfy/workflows";
import type { AgentProviderId } from "../contracts/agent-request";
import { stageModel } from "../agent/config";
import { submitAgentRequest } from "./agent-request";
import { STAGE_LABELS, STAGES, type StageId } from "./constants";
import { readTextIfExists } from "./media";
import { listShotIds, stageDir } from "./paths";
import { checkShotAgent, readShotAgent, writeShotAgent } from "./shot-agent";
import { BULK_CHAINS, writeRunChain } from "./run-chain";
import { readShotMeta, type ShotMeta } from "./shot-meta";
import { PHASE_LABELS, readStageState } from "./stage-state";
import { deriveStageStatus } from "./status";

/*
 * Действия «для всех кадров» над таблицей: каждый кадр получает запрос агенту, как будто
 * пользователь нажал «Отправить агенту» на нужном этапе. Запрос уходит агенту кадра (agent.json). Дальше всё как обычно: агент пишет
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
  /** Кадры, которым этот запуск назначил агента (agent.json). */
  assigned: string[];
}

export interface BulkOptions {
  /**
   * Агент для кадров без своего агента (manual | ollama | claude): назначается им в agent.json.
   * Кадры со своим агентом запускаются им. Нет — у кадра без агента FRAMEBOARD_AGENT_PROVIDER, без назначения.
   */
  provider?: AgentProviderId | string;
  /** Модель провайдера. Нет — по умолчанию. */
  model?: string;
  /** missing (по умолчанию) — назначить только кадрам без агента; always — и кадрам со своим агентом. */
  assign?: "missing" | "always";
  /**
   * Переделать и там, где этап уже пройден: утверждён или есть результат в output/.
   * По умолчанию нет — пройденное не трогается, даже если его делали вручную или агентом на кадре.
   */
  redo?: boolean;
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
  redo: boolean,
): string | null {
  const notNeeded = stageNotNeeded(meta, stageId);
  if (notNeeded) return notNeeded;
  const state = readStageState(episodeId, shotId, stageId);
  if (state.busy) return `этап занят: ${PHASE_LABELS[state.phase].toLowerCase()}`;
  if (!redo) {
    const status = deriveStageStatus(episodeId, shotId, stageId, meta.characters);
    if (status === "approved") return "уже утверждено";
    if (status === "review") return "уже есть результат, ждёт утверждения";
  }
  const choices = listWorkflowChoices(episodeId, shotId, stageId);
  // Этап без воркфлоу доски (персонажи) делает агент сам — здесь не блокируем.
  if (choices.length && !choices.some((choice) => choice.available)) {
    const missing = choices.find((choice) => choice.isDefault)?.missing ?? choices[0].missing;
    return `не хватает: ${missing.join(", ")}`;
  }
  return null;
}

/**
 * Назначает агента из меню кадрам (по умолчанию — только без своего агента).
 * Провайдер и модель проверяются до записи: неверный выбор — ошибка всего запуска.
 */
function assignAgents(result: BulkResult, episodeId: string, shotIds: string[], options: BulkOptions): void {
  if (!options.provider) return;
  const agent = checkShotAgent(options.provider, options.model);
  for (const shotId of shotIds) {
    if (options.assign !== "always" && readShotAgent(episodeId, shotId)) continue;
    writeShotAgent(episodeId, shotId, agent);
    result.assigned.push(shotId);
  }
}

/**
 * Запрос агенту этапа кадра. `chain` — воркфлоу по порядку («▶ Все кадры» на эскизе: LTX, затем
 * MiniMax): первый уходит сейчас, остальные — после прогона, через run_chain.json.
 */
function sendToAgent(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  options: BulkOptions,
  chain: string[] = [],
): void {
  const dir = stageDir(episodeId, shotId, stageId);
  // Агент кадра; у кадра без агента — выбор меню или агент доски по умолчанию.
  const own = readShotAgent(episodeId, shotId);
  const provider = own ? own.provider : options.provider;
  // Документы этапа уходят как есть: массовый запуск ничего в них не меняет.
  const request = submitAgentRequest({
    episodeId,
    shotId,
    stageId,
    message: BULK_MESSAGE,
    prompt: readTextIfExists(path.join(dir, "prompt.md")),
    refsNote: readTextIfExists(path.join(dir, "refs.md")),
    workflowNote: readTextIfExists(path.join(dir, "workflow.md")),
    provider,
    // Этап со своей моделью (первый кадр — Sonnet) важнее модели агента кадра.
    model: stageModel(provider, stageId, own ? (own.model ?? undefined) : options.model),
    ...(chain.length ? { workflow: chain[0] } : {}),
    auto: true,
  });
  writeRunChain(
    episodeId,
    shotId,
    stageId,
    chain.length > 1
      ? { workflows: chain.slice(1), provider: request.provider, model: request.model, createdAt: request.createdAt }
      : null,
  );
}

function tryStart(
  result: BulkResult,
  episodeId: string,
  shotId: string,
  stageId: StageId,
  options: BulkOptions,
  chain: string[] = [],
): void {
  try {
    sendToAgent(episodeId, shotId, stageId, options, chain);
    result.started.push({ shotId, stageId });
  } catch (error) {
    result.skipped.push({ shotId, stageId, reason: error instanceof Error ? error.message : "не запустилось" });
  }
}

/** Кнопка над столбцом этапа: этот этап на всех кадрах эпизода. */
export function runStageForAllShots(episodeId: string, stageId: StageId, options: BulkOptions = {}): BulkResult {
  const result: BulkResult = { started: [], skipped: [], assigned: [] };
  const shotIds = listShotIds(episodeId);
  assignAgents(result, episodeId, shotIds, options);
  for (const shotId of shotIds) {
    const meta = readShotMeta(episodeId, shotId);
    const reason = blocked(episodeId, shotId, stageId, meta, options.redo === true);
    if (reason) result.skipped.push({ shotId, stageId, reason });
    else tryStart(result, episodeId, shotId, stageId, options, BULK_CHAINS[stageId] ?? []);
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

function startNextStage(result: BulkResult, episodeId: string, shotId: string, options: BulkOptions): void {
  const meta = readShotMeta(episodeId, shotId);
  const stageId = nextStage(episodeId, shotId, meta);
  if (!stageId) {
    result.skipped.push({ shotId, stageId: null, reason: "все этапы утверждены" });
    return;
  }
  // Агент уже работает на кадре или этап уже пройден — не перезапускаем.
  const reason = blocked(episodeId, shotId, stageId, meta, false);
  if (reason) result.skipped.push({ shotId, stageId, reason: `${STAGE_LABELS[stageId]}: ${reason}` });
  else tryStart(result, episodeId, shotId, stageId, options);
}

/**
 * Кнопка над столбцом «Кадр»: агент из меню — кадрам без агента. Ничего не запускает: этап
 * начинается только по «Отправить агенту», «▶ Все кадры» или «Запустить следующий этап» в меню кадра.
 */
export function assignShotAgents(episodeId: string, options: BulkOptions = {}): BulkResult {
  const result: BulkResult = { started: [], skipped: [], assigned: [] };
  if (!options.provider) throw new Error("Выберите агента");
  assignAgents(result, episodeId, listShotIds(episodeId), options);
  return result;
}

/**
 * Кнопка на кадре: агент кадра на следующий этап. С `provider` и `assign: "always"` — сначала
 * сохранить этот выбор агентом кадра.
 */
export function runNextStageForShot(episodeId: string, shotId: string, options: BulkOptions = {}): BulkResult {
  const result: BulkResult = { started: [], skipped: [], assigned: [] };
  assignAgents(result, episodeId, [shotId], options);
  startNextStage(result, episodeId, shotId, options);
  return result;
}
