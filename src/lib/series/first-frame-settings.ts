import fs from "fs";
import path from "path";
import { stageDir } from "./paths";
import { excludedFiles, readRunSettings, writeRunSettings } from "./run-settings";
import { mediaUrlPath } from "./media";
import { normalizeCharacterName, readShotMeta } from "./shot-meta";

/**
 * Выбор пользователя на странице первого кадра: дальность каждого персонажа до камеры и подписи
 * к файлам refs/. Хранится в `first_frame/run_settings.json` (`framing`, `refNotes`), пишет только доска.
 * Агент получает их строками в конце сообщения (framingMessage), граф — порядок картинок (binding.ts).
 */

export const FRAMINGS = ["background", "full", "waist", "face"] as const;
export type Framing = (typeof FRAMINGS)[number];

/** Как дальность читает агент. Числа — те, которыми пользователь сам меряет кадр. */
const FRAMING_TEXT: Record<Framing, string> = {
  background: "in the background: the whole figure, small, at most a quarter of the frame height",
  full: "full figure: head to feet in the frame, about three quarters of the frame height",
  waist: "waist up: the bottom edge of the frame cuts the body at the waist, the head in the upper third",
  face: "face close-up: the face is about three quarters of the frame width, nothing below the shoulders",
};

export function isFraming(value: unknown): value is Framing {
  return typeof value === "string" && (FRAMINGS as readonly string[]).includes(value);
}

/** Близко к камере (по пояс, лицо) или не выбрано: портрет лица важнее референсов пользователя. */
export function isNearFraming(value: Framing | undefined): boolean {
  return value !== "background" && value !== "full";
}

/** Дальность по персонажам кадра. Неизвестные значения пропускаются. */
export function readFraming(episodeId: string, shotId: string): Record<string, Framing> {
  const stored = readRunSettings(episodeId, shotId, "first_frame").framing ?? {};
  const result: Record<string, Framing> = {};
  for (const [name, value] of Object.entries(stored)) if (isFraming(value)) result[name.toLowerCase()] = value;
  return result;
}

/** Поставить дальность персонажу или сбросить (`null` — как в сценарии). */
export function setFraming(episodeId: string, shotId: string, name: string, value: string | null) {
  const character = normalizeCharacterName(name);
  const known = readShotMeta(episodeId, shotId).characters.some((item) => item.toLowerCase() === character);
  if (!known) throw new Error(`${character} нет в этом кадре`);
  if (value !== null && !isFraming(value)) throw new Error("Неизвестная дальность");
  const settings = readRunSettings(episodeId, shotId, "first_frame");
  const map = { ...(settings.framing ?? {}) };
  if (value === null) delete map[character];
  else map[character] = value;
  return writeRunSettings(episodeId, shotId, "first_frame", { ...settings, framing: map });
}

/** Подписи к файлам refs/ первого кадра (имя файла → текст). Пустые пропускаются. */
export function readRefNotes(episodeId: string, shotId: string): Record<string, string> {
  const stored = readRunSettings(episodeId, shotId, "first_frame").refNotes ?? {};
  const result: Record<string, string> = {};
  for (const [name, text] of Object.entries(stored)) {
    if (typeof text === "string" && text.trim()) result[name] = text.trim();
  }
  return result;
}

/** Подписать файл refs/ («шлем Лены») или снять подпись пустым текстом. */
export function setRefNote(episodeId: string, shotId: string, fileName: string, text: string) {
  const name = path.basename(fileName.trim());
  if (!name || name !== fileName.trim()) throw new Error("Нужно имя файла в refs/");
  if (!fs.existsSync(path.join(stageDir(episodeId, shotId, "first_frame"), "refs", name))) {
    throw new Error(`${name} нет в refs/`);
  }
  const settings = readRunSettings(episodeId, shotId, "first_frame");
  const map = { ...(settings.refNotes ?? {}) };
  const clean = text.trim().slice(0, 300);
  if (clean) map[name] = clean;
  else delete map[name];
  return writeRunSettings(episodeId, shotId, "first_frame", { ...settings, refNotes: map });
}

/**
 * Строки для агента после сообщения пользователя: дальность каждого, у кого она выбрана, и подписи
 * файлов refs/, которые лежат на диске и не убраны из графа. Нечего сказать — пустая строка.
 */
export function framingMessage(episodeId: string, shotId: string): string {
  const characters = readShotMeta(episodeId, shotId).characters.map((name) => name.toLowerCase());
  const framing = readFraming(episodeId, shotId);
  const distance = characters
    .filter((name) => framing[name])
    .map((name) => `- ${name}: ${FRAMING_TEXT[framing[name]]}`);
  const refs = path.join(stageDir(episodeId, shotId, "first_frame"), "refs");
  const excluded = excludedFiles(episodeId, shotId, "first_frame");
  const notes = Object.entries(readRefNotes(episodeId, shotId))
    .filter(([name]) => {
      const file = path.join(refs, name);
      if (!fs.existsSync(file)) return false;
      const media = mediaUrlPath(file);
      return !(media && excluded.has(media));
    })
    .map(([name, text]) => `- ${name}: ${text}`);
  const parts: string[] = [];
  if (distance.length) parts.push("Distance from the camera, set on the board for each person:", ...distance);
  if (notes.length) {
    if (parts.length) parts.push("");
    parts.push("What the user's reference files are (refs/ of this stage):", ...notes);
  }
  return parts.join("\n");
}

/** Сообщение пользователя с дописанными строками доски. */
export function withFramingMessage(episodeId: string, shotId: string, message: string): string {
  const extra = framingMessage(episodeId, shotId);
  if (!extra) return message;
  return message.trim() ? `${message.trimEnd()}\n\n${extra}` : extra;
}
