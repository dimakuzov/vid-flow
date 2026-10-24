import fs from "fs";
import path from "path";
import { stageDir } from "./paths";
import { excludedFiles, readRunSettings, writeRunSettings } from "./run-settings";
import { mediaUrlPath } from "./media";
import { normalizeCharacterName, readShotMeta } from "./shot-meta";

/**
 * Выбор пользователя на странице первого кадра: дальность каждого персонажа до камеры, кто стоит
 * спиной, подписи к файлам refs/. Хранится в `first_frame/run_settings.json` (`framing`, `backView`,
 * `refNotes`), пишет только доска. Агент получает их блоком задания (framingBlock), граф — порядок
 * картинок и портреты (binding.ts).
 */

export const FRAMINGS = ["background", "full", "waist", "face"] as const;
export type Framing = (typeof FRAMINGS)[number];

/** Как дальность читает агент. Числа — те, которыми пользователь сам меряет кадр. */
const FRAMING_TEXT: Record<Framing, string> = {
  background: "in the background: the whole figure, small, at most a quarter of the frame height",
  full: "full figure: head to feet in the frame; set the height by an object of image 1 next to the person (a door, a bench, a booth), not by a share of the frame",
  waist: "waist up: the bottom edge of the frame cuts the body at the waist, the head in the upper third",
  face: "face close-up: the face is about three quarters of the frame width, the top of the head near the top edge of the frame, the shoulders cut by the bottom edge, nothing below the shoulders",
};

/** Крупный план у двоих и больше: три четверти ширины на каждого не помещаются. */
const FACE_TOGETHER =
  "face close-up together with the others marked so: their faces side by side fill the whole frame, each face about half the frame width, the tops of the heads near the top edge, the shoulders cut by the bottom edge";

/** Человек спиной к камере: портрета у него в графе нет. */
const BACK_TEXT = "seen from behind, the face hidden";

/** Слова разметки и текста кадра, по которым человек стоит спиной к камере. */
const BACK_WORDS = /(^|[^a-z])back([^a-z]|$)|behind|спин|сзади/i;
const BACK_IN_TEXT = /спиной|со спины|from behind|back to the camera|backs to the camera/i;

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

/** Пары `имя: слова` строки `- framing:`. */
function framingPairs(value: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const part of value.split(/[,;，]/)) {
    const pair = part.match(/^\s*([^:=]+?)\s*[:=]\s*(.+?)\s*$/);
    if (pair) pairs.push([pair[1].toLowerCase().replace(/\s+/g, "_"), pair[2]]);
  }
  return pairs;
}

/** `- framing: luba: full, ivan: face` (или `luba=full`) → { luba: "full", ivan: "face" }. */
export function parseFramingLine(value: string): Record<string, Framing> {
  const result: Record<string, Framing> = {};
  for (const [name, raw] of framingPairs(value)) {
    const framing = parseFramingValue(raw.replace(BACK_WORDS, " "));
    if (framing) result[name] = framing;
  }
  return result;
}

/** Кто в строке `- framing:` стоит спиной: `lena: waist back` → ["lena"]. */
export function parseBackLine(value: string): string[] {
  return framingPairs(value)
    .filter(([, raw]) => BACK_WORDS.test(raw))
    .map(([name]) => name);
}

/**
 * Имя из разметки → персонаж кадра. Разметка иногда пишет имя короче или длиннее
 * (`militsiya_officer` при `militsiya_officer_young`): тогда берётся единственный персонаж, чьё имя
 * содержит это имя или содержится в нём. Нет такого или их несколько — null.
 */
export function matchCharacter(name: string, characters: string[]): string | null {
  const key = name.toLowerCase();
  const ids = characters.map((item) => item.toLowerCase());
  if (ids.includes(key)) return key;
  const close = ids.filter((id) => id.includes(key) || key.includes(id));
  return close.length === 1 ? close[0] : null;
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
 * Дальность и «спиной» из разметки сценария при создании кадра. Уже выставленное на доске не
 * трогает, если не overwrite. Персонаж без значения в разметке получает план из текста кадра.
 * Имя разметки, которого нет в кадре, сводится к похожему персонажу (matchCharacter).
 */
export function seedFraming(
  episodeId: string,
  shotId: string,
  characters: string[],
  fromScenario: Record<string, Framing>,
  summary: string,
  overwrite: boolean,
  backFromScenario?: string[],
): void {
  if (!characters.length) return;
  const settings = readRunSettings(episodeId, shotId, "first_frame");
  const map = { ...(settings.framing ?? {}) };
  const fallback = framingFromText(summary);
  const scenario: Record<string, Framing> = {};
  for (const [name, value] of Object.entries(fromScenario)) {
    const id = matchCharacter(name, characters);
    if (id) scenario[id] = value;
  }
  let changed = false;
  for (const name of characters.map((item) => item.toLowerCase())) {
    if (!overwrite && isFraming(map[name])) continue;
    const next = scenario[name] ?? fallback;
    if (map[name] !== next) changed = true;
    map[name] = next;
  }
  const next = { ...settings, framing: map };
  if (backFromScenario && (overwrite || !Array.isArray(settings.backView))) {
    const back = backFromScenario
      .map((name) => matchCharacter(name, characters))
      .filter((id): id is string => Boolean(id));
    next.backView = [...new Set(back)].sort();
    changed = true;
  }
  if (changed) writeRunSettings(episodeId, shotId, "first_frame", next);
}

/**
 * Кто в кадре стоит спиной к камере: выбор на доске или разметка сценария. Пока этого нет (кадры,
 * созданные раньше), кадр с одним персонажем берёт это из текста кадра: «спиной», «со спины».
 */
export function readBackView(episodeId: string, shotId: string): Set<string> {
  const meta = readShotMeta(episodeId, shotId);
  const characters = meta.characters.map((item) => item.toLowerCase());
  const stored = readRunSettings(episodeId, shotId, "first_frame").backView;
  if (Array.isArray(stored)) {
    return new Set(stored.map((item) => String(item).toLowerCase()).filter((item) => characters.includes(item)));
  }
  return new Set(characters.length === 1 && BACK_IN_TEXT.test(meta.summary) ? characters : []);
}

/** Отметить, что персонаж стоит спиной (портрет в граф не идёт), или снять отметку. */
export function setBackView(episodeId: string, shotId: string, name: string, back: boolean) {
  const character = normalizeCharacterName(name);
  const known = readShotMeta(episodeId, shotId).characters.some((item) => item.toLowerCase() === character);
  if (!known) throw new Error(`${character} нет в этом кадре`);
  const set = readBackView(episodeId, shotId);
  if (back) set.add(character);
  else set.delete(character);
  const settings = readRunSettings(episodeId, shotId, "first_frame");
  return writeRunSettings(episodeId, shotId, "first_frame", { ...settings, backView: [...set].sort() });
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
 * Блок задания агенту: дальность каждого персонажа кадра, кто стоит спиной, подписи файлов refs/,
 * которые лежат на диске и не убраны из графа. Это текущий выбор на доске; в сообщение пользователя
 * и в его заметки он не попадает. Нечего сказать — пустая строка.
 */
export function framingBlock(episodeId: string, shotId: string): string {
  const characters = readShotMeta(episodeId, shotId).characters.map((name) => name.toLowerCase());
  const framing = readFraming(episodeId, shotId);
  const back = readBackView(episodeId, shotId);
  const together = characters.filter((name) => framing[name] === "face").length > 1;
  const distance = characters
    .filter((name) => framing[name])
    .map((name) => {
      const size = framing[name] === "face" && together ? FACE_TOGETHER : FRAMING_TEXT[framing[name]];
      return `- ${name}: ${back.has(name) ? `${BACK_TEXT}; ` : ""}${size}`;
    });
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
  if (distance.length) {
    parts.push(
      "## Distance from the camera (set on the board for each person; this is the current choice, older notes may name another size)",
      "",
      ...distance,
    );
  }
  if (notes.length) {
    if (parts.length) parts.push("");
    parts.push("## What the user's reference files are (refs/ of this stage)", "", ...notes);
  }
  return parts.join("\n");
}
