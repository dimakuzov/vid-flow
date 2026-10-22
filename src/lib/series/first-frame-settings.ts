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

/** Слова в строке `- framing:` разметки сценария → значение. */
const FRAMING_WORDS: [RegExp, Framing][] = [
  [/background|задн|фон|вдал/i, "background"],
  [/face|close|крупн|лиц/i, "face"],
  [/waist|medium|пояс|средн/i, "waist"],
  [/full|wide|рост|общ/i, "full"],
];

/** Одно значение дальности из слова разметки. Не узнали — null. */
export function parseFramingValue(raw: string): Framing | null {
  const value = raw.trim().toLowerCase();
  if (isFraming(value)) return value;
  return FRAMING_WORDS.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

/** `- framing: luba: full, ivan: face` (или `luba=full`) → { luba: "full", ivan: "face" }. */
export function parseFramingLine(value: string): Record<string, Framing> {
  const result: Record<string, Framing> = {};
  for (const part of value.split(/[,;，]/)) {
    const pair = part.match(/^\s*([^:=]+?)\s*[:=]\s*(.+?)\s*$/);
    if (!pair) continue;
    const framing = parseFramingValue(pair[2]);
    if (framing) result[pair[1].toLowerCase().replace(/\s+/g, "_")] = framing;
  }
  return result;
}

/**
 * Дальность, когда в разметке её нет (кадры, созданные до строки `- framing:`): план из текста
 * кадра — первое упоминание «крупный / средний / общий план». Нет ничего — в полный рост.
 */
export function framingFromText(text: string): Framing {
  const plans: [RegExp, Framing][] = [
    [/крупн\S* план|close[- ]?up/i, "face"],
    [/средн\S* план|по пояс|medium shot/i, "waist"],
    [/общ\S* план|дальн\S* план|в полный рост|wide shot|full shot/i, "full"],
  ];
  let best: { at: number; framing: Framing } | null = null;
  for (const [pattern, framing] of plans) {
    const at = text.search(pattern);
    if (at >= 0 && (!best || at < best.at)) best = { at, framing };
  }
  return best?.framing ?? "full";
}

/**
 * Дальность каждого персонажа кадра: выбор на доске (при создании кадра его ставит разметка
 * сценария), иначе план из текста кадра. Пустых значений нет: агент и граф видят ровно то, что выставлено.
 */
export function readFraming(episodeId: string, shotId: string): Record<string, Framing> {
  const stored = readRunSettings(episodeId, shotId, "first_frame").framing ?? {};
  const set: Record<string, Framing> = {};
  for (const [name, value] of Object.entries(stored)) if (isFraming(value)) set[name.toLowerCase()] = value;
  const meta = readShotMeta(episodeId, shotId);
  const fallback = framingFromText(meta.summary);
  const result: Record<string, Framing> = {};
  for (const name of meta.characters.map((item) => item.toLowerCase())) result[name] = set[name] ?? fallback;
  return result;
}

/**
 * Дальность из разметки сценария при создании кадра. Уже выставленное на доске не трогает, если
 * не overwrite. Персонаж без значения в разметке получает план из текста кадра.
 */
export function seedFraming(
  episodeId: string,
  shotId: string,
  characters: string[],
  fromScenario: Record<string, Framing>,
  summary: string,
  overwrite: boolean,
): void {
  if (!characters.length) return;
  const settings = readRunSettings(episodeId, shotId, "first_frame");
  const map = { ...(settings.framing ?? {}) };
  const fallback = framingFromText(summary);
  let changed = false;
  for (const name of characters.map((item) => item.toLowerCase())) {
    if (!overwrite && isFraming(map[name])) continue;
    const next = fromScenario[name] ?? fallback;
    if (map[name] !== next) changed = true;
    map[name] = next;
  }
  if (changed) writeRunSettings(episodeId, shotId, "first_frame", { ...settings, framing: map });
}

/** Поставить дальность персонажу или сбросить (`null` — снова план из текста кадра). */
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
