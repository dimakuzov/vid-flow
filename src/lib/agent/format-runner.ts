import fs from "fs";
import path from "path";
import type { AgentRequestFile, AgentResult } from "../contracts/agent-request";
import { applyBootstrap, parseScenario } from "../series/bootstrap";
import { readFormatRequest, writeFormatRequest, FORMAT_RULES, type FormatRequest } from "../series/format-request";
import { readTextIfExists, writeText } from "../series/media";
import { episodeRoot, getCharactersRoot, getLocationsRoot } from "../series/paths";
import { formatMinutes, modeTimeoutMs } from "./config";
import { cleanPromptText, getAgentProvider } from "./providers";

/*
 * Разметка сценария моделью, которую зовёт доска (кнопка «Добавить» в шапке):
 * scenario_raw.md → модель → scenario.md → кадры в таблице. Ход — в format_request.json.
 */

const KEY = "__frameboardFormatRuns";

function liveRuns(): Map<string, AbortController> {
  const g = globalThis as typeof globalThis & { [KEY]?: Map<string, AbortController> };
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY]!;
}

export function isFormatRunLive(episodeId: string): boolean {
  return liveRuns().has(episodeId);
}

export const FORMAT_STOPPED = "Разметка остановлена";

/**
 * Остановка разметки (`npm run agents -- stop`): живой прогон получает abort, ждущий у провайдера
 * доски больше не запустится. Запрос становится `error` с FORMAT_STOPPED — «Добавить» можно нажать снова.
 * false — останавливать нечего (нет запроса, manual, уже закончен).
 */
function stoppedByUser(controller: AbortController): boolean {
  const reason: unknown = controller.signal.reason;
  return controller.signal.aborted && reason instanceof Error && reason.message === FORMAT_STOPPED;
}

export function abortFormatRun(episodeId: string): boolean {
  const request = readFormatRequest(episodeRoot(episodeId));
  const controller = liveRuns().get(episodeId);
  const waiting =
    request && (request.provider ?? "manual") !== "manual" && (request.status === "pending" || request.status === "running");
  if (!controller && !waiting) return false;
  if (controller) {
    liveRuns().delete(episodeId);
    controller.abort(new Error(FORMAT_STOPPED));
  }
  if (request && (request.status === "pending" || request.status === "running")) {
    writeFormatRequest({ ...request, status: "error", error: FORMAT_STOPPED, finishedAt: new Date().toISOString() });
  }
  return true;
}

const SYSTEM = `Ты размечаешь сырой сценарий видео на кадры для доски Frameboard.
Ответь только текстом файла scenario.md: без вступления, пояснений и обрамления \`\`\`.

${FORMAT_RULES}`;

function folderNames(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function buildFormatPrompt(raw: string): { system: string; user: string } {
  const characters = folderNames(getCharactersRoot());
  const locations = folderNames(getLocationsRoot());
  const user = [
    "## Библиотека",
    "",
    `- персонажи: ${characters.join(", ") || "(пусто)"}`,
    `- локации: ${locations.join(", ") || "(пусто)"}`,
    "",
    "## Сырой сценарий",
    "",
    raw.trim(),
    "",
    "Напиши scenario.md.",
  ].join("\n");
  return { system: SYSTEM, user };
}

function finish(request: FormatRequest, patch: Partial<FormatRequest>): void {
  // Запрос заменили новым, пока модель работала: старый результат не пишем.
  const current = readFormatRequest(episodeRoot(request.episodeId));
  if (!current || current.createdAt !== request.createdAt) return;
  writeFormatRequest({ ...current, ...patch, finishedAt: new Date().toISOString() });
}

/** Ответ модели → scenario.md и кадры таблицы. Ошибка — строка для пользователя. */
export function applyFormatResult(request: FormatRequest, result: AgentResult): void {
  if (result.status === "error") {
    finish(request, { status: "error", error: result.error || "Модель вернула ошибку" });
    return;
  }
  const scenario = cleanPromptText(result.prompt ?? "");
  const shots = scenario ? parseScenario(scenario).shots.length : 0;
  if (!shots) {
    finish(request, { status: "error", error: "Модель не вернула кадров «## s01». Попробуйте другую модель." });
    return;
  }
  const root = episodeRoot(request.episodeId);
  writeText(path.join(root, "scenario.md"), scenario.endsWith("\n") ? scenario : `${scenario}\n`);
  const created = applyBootstrap({ episodeId: request.episodeId, scenario });
  finish(request, { status: "done", error: undefined, shots: created.created.length + created.updated.length });
}

/** Запускает разметку `pending`-запроса эпизода в фоне. null — нечего запускать. */
export function startFormatRun(episodeId: string): Promise<void> | null {
  const root = episodeRoot(episodeId);
  const request = readFormatRequest(root);
  if (!request || request.status !== "pending") return null;
  const providerId = request.provider ?? "manual";
  if (providerId === "manual" || isFormatRunLive(episodeId)) return null;

  const provider = getAgentProvider(providerId);
  if (!provider.modes.includes("text")) {
    writeFormatRequest({ ...request, status: "error", error: `${provider.label} не умеет разметку текста` });
    return null;
  }
  const running: FormatRequest = { ...request, status: "running", startedAt: new Date().toISOString() };
  writeFormatRequest(running);

  const controller = new AbortController();
  liveRuns().set(episodeId, controller);
  // Сценарий длинный, локальная модель может думать долго: предел как у агентного режима.
  const timeoutMs = modeTimeoutMs("agent");
  const timer = setTimeout(
    () => controller.abort(new Error(`Модель не ответила за ${formatMinutes(timeoutMs)}`)),
    timeoutMs,
  );
  const { system, user } = buildFormatPrompt(readTextIfExists(path.join(root, "scenario_raw.md")));
  // Провайдеру нужен запрос с моделью; остальные поля разметке не нужны.
  const fakeRequest = { id: `format-${episodeId}`, episodeId, model: request.model } as AgentRequestFile;

  return provider
    .run(
      { request: fakeRequest, mode: "text", stageDir: root, projectRoot: process.cwd(), taskMarkdown: "", system, user, timeoutMs },
      controller.signal,
    )
    .catch((error: unknown): AgentResult => {
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      return { status: "error", error: reason instanceof Error ? reason.message : "Модель упала" };
    })
    // Остановили, пока модель отвечала: ответ не применяем, запрос уже `error`.
    .then((result) => (stoppedByUser(controller) ? undefined : applyFormatResult(running, result)))
    .catch((error: unknown) => {
      finish(running, { status: "error", error: error instanceof Error ? error.message : "Не удалось собрать таблицу" });
    })
    .finally(() => {
      clearTimeout(timer);
      if (liveRuns().get(episodeId) === controller) liveRuns().delete(episodeId);
    });
}
