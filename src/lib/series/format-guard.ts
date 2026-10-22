/**
 * Сырой сценарий с номерами сцен: название после номера и порядок реплик
 * не отдаются модели на переписывание. Модель по-прежнему выбирает персонажей,
 * локацию, длительность и текст действия, если не раздробила сцены.
 */

export interface RawScene {
  number: number;
  /** Текст на строке номера после самого номера. Пусто — явного названия нет. */
  title: string;
  /** «Имя: текст» в порядке сырого сценария. */
  speeches: string[];
  lines: string[];
  /** Кусок сырого сценария этой сцены, вместе с заголовком и ракурсами. */
  text: string;
}

const VIEW_RE = /^\s*(?:кадр|сцена|shot|scene)?\s*\d{1,3}\s*[A-Za-zА-Яа-яЁё]\s*[.)]/iu;
const SCENE_RE = /^\s*(?:(?:кадр|сцена|shot|scene)\s+)?(\d{1,3})\s*[.)]\s*(.*)$/iu;
const WORD_SCENE_RE = /^\s*(?:shot|scene|кадр|сцена)\s+(\d{1,3})\b\s*[.:)]?\s*(.*)$/iu;

/** Ракурс (`1A`, `2A. WIDE`) — не новая сцена. */
function isViewLine(line: string): boolean {
  return VIEW_RE.test(line);
}

/** Строка номера сцены. Повтор того же номера — продолжение, не новый кадр. */
function matchSceneHeading(line: string): { number: number; title: string } | null {
  if (isViewLine(line)) return null;
  const match = line.match(SCENE_RE) ?? line.match(WORD_SCENE_RE);
  if (!match) return null;
  return { number: Number(match[1]), title: match[2].trim().replace(/\s+/g, " ") };
}

const SHOT_WORD = /^(INT|EXT|ИНТ|НАТ|ЭКСТ|SHOT|WIDE|CLOSE|MEDIUM|EXTREME|INSERT|TRACKING|POV|SCENE|КАДР|СЦЕНА|CLOSE-UP|MCU|CU|WS|MS)$/i;

/** Имя говорящего отдельной строкой, как в сценарии: `LENA` или `OFFICER (coldly)`. */
function cueName(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80 || /^\(.*\)$/.test(trimmed)) return null;
  if (/\b(VO|V\.O\.|O\.S\.)\b/i.test(trimmed)) return null;
  const name = trimmed.replace(/\s*\([^)]*\)\s*/g, " ").trim().replace(/\s+/g, " ");
  if (!name || name.length > 40) return null;
  if (!/^[\p{Lu}][\p{Lu} .''’-]*$/u.test(name)) return null;
  const words = name.split(" ");
  if (words.length > 4) return null;
  if (words.every((word) => SHOT_WORD.test(word.replace(/\./g, "")))) return null;
  if (/\b(WIDE|CLOSE|MEDIUM|EXTREME|INSERT|TRACKING|POV|SHOT)\b/i.test(name)) return null;
  return name;
}

/** Реплика в той же строке: `Катя: Мама, я дома.` */
function inlineSpeech(line: string): string | null {
  const match = line.trim().match(/^(\p{Lu}[\p{L}''’.-]{0,24}(?:\s+\p{Lu}[\p{L}''’.-]{0,24}){0,2})\s*[:：]\s+(\S.*)$/u);
  if (!match) return null;
  if (SHOT_WORD.test(match[1].replace(/\./g, ""))) return null;
  return `${match[1]}: ${match[2].trim()}`;
}

/** Первая строка речи после имени. Ремарка в скобках и пустые строки пропускаются. */
function firstDialogue(lines: string[], start: number): { text: string; next: number } | null {
  let index = start;
  while (index < lines.length && (!lines[index].trim() || /^\(.*\)$/.test(lines[index].trim()))) index += 1;
  if (index >= lines.length) return null;
  const text = lines[index].trim();
  if (!text || text.length > 240 || cueName(lines[index]) || inlineSpeech(lines[index]) || /--ar\b/.test(text)) return null;
  return { text: text.replace(/^[-–—]\s*/, ""), next: index + 1 };
}

/** Реплики куска сцены в том порядке, в каком они написаны. */
function speechesFrom(lines: string[]): string[] {
  const speeches: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const inline = inlineSpeech(lines[index]);
    if (inline) {
      speeches.push(inline);
      index += 1;
      continue;
    }
    const name = cueName(lines[index]);
    if (name) {
      const said = firstDialogue(lines, index + 1);
      if (said) {
        speeches.push(`${name}: ${said.text}`);
        index = said.next;
        continue;
      }
    }
    index += 1;
  }
  return speeches;
}

/** Сцены сырого текста: один номер — одна сцена, ракурсы внутрь неё. */
export function rawScenes(raw: string): RawScene[] {
  const scenes: RawScene[] = [];
  const byNumber = new Map<number, RawScene>();
  let current: RawScene | null = null;
  const keep = (scene: RawScene, line: string) => {
    scene.text = scene.text ? `${scene.text}\n${line}` : line;
  };
  for (const line of raw.split(/\r?\n/)) {
    if (isViewLine(line)) {
      if (current) keep(current, line);
      continue;
    }
    const heading = matchSceneHeading(line);
    if (heading) {
      const same = byNumber.get(heading.number);
      if (same) {
        current = same;
        if (!same.title && heading.title) same.title = heading.title;
        keep(same, line);
      } else {
        current = { number: heading.number, title: heading.title, speeches: [], lines: [], text: line };
        byNumber.set(heading.number, current);
        scenes.push(current);
      }
      continue;
    }
    if (current) {
      current.lines.push(line);
      keep(current, line);
    }
  }
  for (const scene of scenes) scene.speeches = speechesFrom(scene.lines);
  return scenes;
}

/** Текст сцены из сырого сценария для кадра s01, s02, … Новые кадры с названием сюда не попадают. */
export function rawSceneText(raw: string, shotId: string): string {
  const match = /^s(\d+)$/i.exec(shotId);
  if (!match || !raw.trim()) return "";
  const scenes = rawScenes(raw);
  const number = Number(match[1]);
  const scene = scenes.find((item) => item.number === number) ?? scenes[number - 1];
  return scene?.text.trim() ?? "";
}

function shotId(index: number): string {
  return `s${String(index + 1).padStart(2, "0")}`;
}

/** Короткий текст действия из тела сцены, без имён, реплик и ремарок. */
function proseOf(scene: RawScene): string {
  const spoken = new Set(scene.speeches.map((line) => line.split(":").slice(1).join(":").trim()));
  const kept: string[] = [];
  for (const line of scene.lines) {
    const text = line.trim();
    if (!text || cueName(line) || inlineSpeech(line) || /^\(.*\)$/.test(text) || /--ar\b/.test(text)) continue;
    if (spoken.has(text.replace(/^[-–—]\s*/, ""))) continue;
    kept.push(text);
  }
  return kept.join("\n").slice(0, 700);
}

interface ModelShot {
  title: string;
  characters: string[];
  location: string;
  durationSec?: number;
  framing?: Record<string, string>;
  speech?: string[];
  summary: string;
}

/** Список для подсказки модели: названия и реплики, которые нельзя переставить. */
export function formatLawNote(raw: string): string {
  const scenes = rawScenes(raw);
  if (!scenes.length) return "";
  const lines = [
    "## Закон этого текста",
    "",
    `Сцен с номером: ${scenes.length}. Блоков ## sNN — ровно столько. Сцену не дробить и кадры не добавлять.`,
    "Название после номера копируй дословно. Реплики копируй дословно и в этом порядке:",
    "",
  ];
  scenes.forEach((scene, index) => {
    const id = shotId(index);
    lines.push(scene.title ? `- ${id}: ${scene.title}` : `- ${id}: названия после номера нет, можно дать короткое`);
    for (const speech of scene.speeches) lines.push(`  - ${speech}`);
  });
  return lines.join("\n");
}

function renderShot(id: string, title: string, shot: ModelShot | undefined, scene: RawScene, summary: string): string {
  const lines = [`## ${id} ${title}`.trimEnd()];
  if (shot?.characters.length) lines.push(`- characters: ${shot.characters.join(", ")}`);
  if (shot?.location.trim()) lines.push(`- location: ${shot.location.trim()}`);
  if (shot?.durationSec) lines.push(`- duration: ${shot.durationSec}`);
  const framing = Object.entries(shot?.framing ?? {});
  if (framing.length) lines.push(`- framing: ${framing.map(([name, value]) => `${name}: ${value}`).join(", ")}`);
  const speeches = scene.speeches.length ? scene.speeches : (shot?.speech ?? []);
  for (const speech of speeches) lines.push(`- speech: ${speech}`);
  if (summary) lines.push(summary);
  return `${lines.join("\n")}\n`;
}

function headingFromRaw(raw: string): string {
  const first = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  if (!first || matchSceneHeading(first) || isViewLine(first)) return "Серия";
  return first.replace(/^#\s*/, "").slice(0, 80);
}

/**
 * Подменяет ответ модели там, где сырой текст уже задал сцены.
 * Название после номера и порядок реплик берутся из текста. Своё название остаётся,
 * только если после номера его не было. Число кадров равно числу сцен.
 */
export function lockFormattedScenario(raw: string, formatted: string, shots: ModelShot[], seriesTitle: string): string {
  const scenes = rawScenes(raw);
  if (!scenes.length) return formatted;
  const episodeTitle = seriesTitle && seriesTitle !== "Серия" ? seriesTitle : headingFromRaw(raw);
  const aligned = shots.length === scenes.length;
  const blocks = scenes.map((scene, index) => {
    const shot = aligned ? shots[index] : undefined;
    const shotTitle = scene.title || shot?.title || `Кадр ${scene.number}`;
    const summary = (aligned ? shot?.summary.trim() : "") || proseOf(scene);
    return renderShot(shotId(index), shotTitle, shot, scene, summary);
  });
  return `# ${episodeTitle}\n\n${blocks.join("\n")}`;
}
