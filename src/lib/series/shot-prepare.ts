import fs from "fs";
import path from "path";
import type { AgentRequestFile, AgentResult } from "../contracts/agent-request";
import { FORMAT_CLAUDE_MODEL, formatMinutes, modeTimeoutMs } from "../agent/config";
import { cleanPromptText, getAgentProvider } from "../agent/providers";
import { parseScenario } from "./bootstrap";
import { seedFraming } from "./first-frame-settings";
import { readTextIfExists, writeText } from "./media";
import { getCharactersRoot, getLocationsRoot, shotDir } from "./paths";
import { readRunSettings, writeRunSettings } from "./run-settings";
import { normalizeCharacterName, readShotMeta, setShotCharacters, setShotFragment } from "./shot-meta";
import { writeShotSpeech } from "./speech";
import { readStatusFile, writeStatusFile } from "./status";

const PLACEHOLDER = "Описание кадра пока не задано.";

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

function locationId(raw: string): string {
  const id = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (!id) return "";
  if (!/^[a-z0-9_-]+$/.test(id)) throw new Error("Локация — латиница, цифры, _ и -. Например kitchen");
  return id;
}

function characterIds(names: string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    let name: string;
    try {
      name = normalizeCharacterName(raw);
    } catch {
      throw new Error(`Персонаж «${raw}» пиши латиницей, как папку в библиотеке`);
    }
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Меняет строку локации и раздел Summary. Заголовок и fragment.md не трогает. */
function writePlaceAndAction(episodeId: string, shotId: string, location: string, action: string): void {
  const file = path.join(shotDir(episodeId, shotId), "shot.md");
  let content = readTextIfExists(file);
  const locationLine = /^(-[\s]*(?:location|локация)[\s]*:).*$/im;
  if (locationLine.test(content)) content = content.replace(locationLine, `$1 ${location}`);
  else if (content.trim()) content = content.replace(/^(#.+)$/m, `$1\n\n- location: ${location}`);
  const block = `## Summary\n${action.trim()}\n`;
  if (/##\s*Summary\s*\n/i.test(content)) {
    content = content.replace(/##\s*Summary\s*\n[\s\S]*?(?=\n##\s|$)/i, block);
  } else if (content.trim()) {
    content = `${content.trimEnd()}\n\n${block}`;
  }
  writeText(file, content.endsWith("\n") ? content : `${content}\n`);
}

/**
 * Ответ модели про один кадр → персонажи, локация, реплики, длительность и действие.
 * Id и имя кадра остаются как их задал пользователь. Другие кадры не меняются.
 */
export function applyPreparedShot(episodeId: string, shotId: string, markdown: string): void {
  const parsed = parseScenario(markdown);
  if (parsed.shots.length !== 1) {
    throw new Error(
      parsed.shots.length
        ? "Модель разбила кадр на несколько. Нужен один кадр."
        : "Модель не вернула кадр.",
    );
  }
  const shot = parsed.shots[0];
  const characters = characterIds(shot.characters);
  const location = locationId(shot.location);
  const action = shot.summary.trim();
  if (!action) throw new Error("Модель не написала действие кадра");
  writePlaceAndAction(episodeId, shotId, location, action);
  setShotCharacters(episodeId, shotId, characters);
  writeShotSpeech(episodeId, shotId, (shot.speech ?? []).join("\n"));
  seedFraming(episodeId, shotId, characters, shot.framing ?? {}, action, false);
  const seconds = Math.min(12, Math.max(2, shot.durationSec ?? 5));
  const settings = readRunSettings(episodeId, shotId, "video_preview");
  writeRunSettings(episodeId, shotId, "video_preview", { ...settings, durationSec: seconds });
  const status = readStatusFile(episodeId, shotId, "characters");
  writeStatusFile(episodeId, shotId, "characters", { ...status, expectedCharacters: characters });
}

function promptFor(shotId: string, title: string, source: string): { system: string; user: string } {
  const system = `Ты готовишь один уже существующий кадр для доски Frameboard.
Ответь только одним блоком, без вступления и без обрамления \`\`\`.
Другой кадр не добавляй и этот не дели. Сюжет не выдумывай.
Заголовок оставь дословно: \`## ${shotId} ${title}\`.

- characters: имена из библиотеки, строчная латиница, пробел — \`_\`. Нет в кадре — пусто.
- location: id папки локации из библиотеки, так же латиницей. Нет места — пусто.
- duration: целое от 2 до 12. Реплике нужно примерно 1 секунда на 2–3 слова плюс секунда на начало и конец. Нет оснований — 5.
- framing: как далеко от камеры каждый персонаж в первом кадре, \`имя: слово\` через запятую: background — на заднем плане, full — в полный рост, waist — по пояс, face — крупно лицо. «Крупный план» — face, «средний» — waist, «общий» — full. Нет оснований — full.
- speech: прямая речь дословно и в том же порядке, одна реплика — одна строка \`- speech: Имя: текст\`. Голос за кадром и ремарки — не реплики. Никто не говорит — строк speech нет.
Текст действия реплики не повторяет.`;
  const user = [
    "## Библиотека",
    "",
    `- персонажи: ${folderNames(getCharactersRoot()).join(", ") || "(пусто)"}`,
    `- локации: ${folderNames(getLocationsRoot()).join(", ") || "(пусто)"}`,
    "",
    `## Кадр ${shotId}`,
    "",
    `Имя кадра: ${title}`,
    "",
    source,
    "",
    "Напиши один блок кадра.",
  ].join("\n");
  return { system, user };
}

/** Текст карточки → поля, без которых следующие этапы и агенты кадр не соберут. */
export async function prepareUserShot(episodeId: string, shotId: string, text: string): Promise<void> {
  const source = text.trim();
  if (!source || source === PLACEHOLDER) throw new Error("Сначала впиши текст кадра");
  const meta = readShotMeta(episodeId, shotId);
  setShotFragment(episodeId, shotId, source);
  const provider = getAgentProvider("claude");
  if (!provider.modes.includes("text")) throw new Error(`${provider.label} не готовит кадр по тексту`);
  const timeoutMs = modeTimeoutMs("agent");
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Модель не ответила за ${formatMinutes(timeoutMs)}`)),
    timeoutMs,
  );
  const { system, user } = promptFor(shotId, meta.title, source);
  const request = { id: `prepare-${shotId}`, episodeId, model: FORMAT_CLAUDE_MODEL } as AgentRequestFile;
  let result: AgentResult;
  try {
    result = await provider.run(
      {
        request,
        mode: "text",
        stageDir: shotDir(episodeId, shotId),
        projectRoot: process.cwd(),
        taskMarkdown: "",
        system,
        user,
        timeoutMs,
      },
      controller.signal,
    );
  } catch (error) {
    const reason = controller.signal.aborted ? controller.signal.reason : error;
    throw new Error(reason instanceof Error ? reason.message : "Модель упала");
  } finally {
    clearTimeout(timer);
  }
  if (result.status === "error") throw new Error(result.error || "Модель вернула ошибку");
  applyPreparedShot(episodeId, shotId, cleanPromptText(result.prompt ?? ""));
}
