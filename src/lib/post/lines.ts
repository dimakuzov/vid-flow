import path from "path";
import { listMediaFiles } from "../series/media";
import { stageDir } from "../series/paths";
import { readShotMeta } from "../series/shot-meta";
import { readShotSpeech } from "../series/speech";
import { detectSilences, probeMedia, soundIntervals, type Interval, type MediaProbe } from "./ffmpeg";
import { activeShotIds, linesFile, readJson, writeJson } from "./paths";
import { speakerResolver } from "./speakers";

/*
 * Таблица реплик `post/lines.json`. Текст и персонаж — всегда из speech.md кадров (правятся там),
 * в файле хранятся только правки доски: место реплики в кадре и подрезка границ.
 */

export interface PostLine {
  /** `{shotId}-{номер строки в speech.md}`: s05-2. */
  id: string;
  shotId: string;
  /** Номер реплики в кадре, с 1. */
  index: number;
  /** Номер реплики в эпизоде, с 1 (порядок кадров — порядок таблицы). */
  order: number;
  /** Персонаж библиотеки, чей голос и дорожка (по назначению имени, см. speakers.ts). */
  character: string;
  /** Имя как в speech.md (из сценария): BABUSHKA, MALE VOICE. */
  speaker: string;
  text: string;
  /** Секунды от начала кадра, где начинается речь. */
  at: number;
  /** true — место задал пользователь; иначе доска считает его сама. */
  atManual: boolean;
  /** Сдвиг начала и конца отрезка относительно авто-границ, секунды (минус — раньше). */
  trimIn: number;
  trimOut: number;
  /** Скорость, заданная вручную; null — доска подгоняет под губы сама (или 1). */
  speed: number | null;
}

/** Что хранится в lines.json по каждой реплике. */
interface StoredLine {
  id: string;
  shotId: string;
  character: string;
  text: string;
  order: number;
  at: number;
  atManual?: boolean;
  trimIn?: number;
  trimOut?: number;
  speed?: number | null;
}

interface LinesFile {
  updatedAt: string;
  lines: StoredLine[];
}

export interface SpeechLine {
  index: number;
  /** Пусто — имя не указано, и в кадре не один персонаж. */
  character: string;
  text: string;
}

const NAME = /^([^:«"„“]{1,40}):\s*(\S.*)$/;

/** Строки speech.md → реплики. Строка без имени — реплика единственного персонажа кадра. */
export function parseSpeechLines(text: string, shotCharacters: string[] = []): SpeechLine[] {
  const result: SpeechLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*]\s+/, "").trim();
    if (!line) continue;
    const match = line.match(NAME);
    const character = match ? match[1].trim() : shotCharacters.length === 1 ? shotCharacters[0] : "";
    const phrase = (match ? match[2] : line)
      .trim()
      .replace(/^[«"„“]+|[»"“”]+$/g, "")
      .trim();
    if (!phrase) continue;
    result.push({ index: result.length + 1, character, text: phrase });
  }
  return result;
}

export interface ShotFinal {
  shotId: string;
  /** Абсолютный путь финала (`final_render/approve/`), null — финала нет. */
  file: string | null;
  probe: MediaProbe | null;
  /** Звучащие отрезки своего звука финала (H3, HeyGen); null — звука нет. */
  sounds: Interval[] | null;
}

/** Финал кадра: первое видео в `final_render/approve/`. */
export async function readShotFinal(episodeId: string, shotId: string): Promise<ShotFinal> {
  const video = listMediaFiles(path.join(stageDir(episodeId, shotId, "final_render"), "approve")).find(
    (file) => file.kind === "video",
  );
  if (!video) return { shotId, file: null, probe: null, sounds: null };
  const file = path.join(stageDir(episodeId, shotId, "final_render"), "approve", video.name);
  const probe = await probeMedia(file);
  if (!probe.hasAudio) return { shotId, file, probe, sounds: null };
  const sounds = soundIntervals(await detectSilences(file), probe.duration);
  return { shotId, file, probe, sounds };
}

/** Отступ от начала кадра и между репликами при расстановке подряд. */
export const LINE_START_SEC = 0.3;
export const LINE_GAP_SEC = 0.4;

/** Длительность речи без озвучки — по тексту, ~15 символов в секунду. */
export function estimateSpeechSec(text: string): number {
  return Math.max(0.8, text.length / 15);
}

/**
 * Звучащие отрезки → `count` групп: границы групп — самые длинные паузы.
 * Реплика с паузой внутри остаётся одной группой, если смены говорящих длиннее.
 */
export function groupSounds(sounds: Interval[], count: number): Interval[] {
  if (count <= 0) return [];
  if (sounds.length <= count) return sounds.map((sound) => ({ ...sound }));
  const gaps = sounds
    .slice(1)
    .map((sound, index) => ({ index, size: sound.start - sounds[index].end }))
    .sort((a, b) => b.size - a.size || a.index - b.index)
    .slice(0, count - 1)
    .map((gap) => gap.index)
    .sort((a, b) => a - b);
  const groups: Interval[] = [];
  let first = 0;
  for (const cut of [...gaps, sounds.length - 1]) {
    groups.push({ start: sounds[first].start, end: sounds[cut].end });
    first = cut + 1;
  }
  return groups;
}

/**
 * Места реплик кадра. Ручные (`atManual`) не трогаются. Остальные: по звуку финала, если он есть
 * (H3, HeyGen — там уже звучит речь), иначе подряд за предыдущей репликой.
 */
export function autoPlaceShot(
  lines: { at: number; atManual: boolean; text: string }[],
  sounds: Interval[] | null,
  durationOf: (index: number) => number,
): number[] {
  const groups = sounds && sounds.length ? groupSounds(sounds, lines.length) : [];
  const result: number[] = [];
  let previousEnd = 0;
  lines.forEach((line, index) => {
    let at: number;
    if (line.atManual) at = line.at;
    else if (groups[index]) at = groups[index].start;
    else at = index === 0 ? LINE_START_SEC : previousEnd + LINE_GAP_SEC;
    at = Math.max(0, Math.round(at * 1000) / 1000);
    result.push(at);
    previousEnd = at + durationOf(index);
  });
  return result;
}

function readStored(episodeId: string): Map<string, StoredLine> {
  const file = readJson<LinesFile>(linesFile(episodeId));
  return new Map((file?.lines ?? []).map((line) => [line.id, line]));
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Реплики эпизода: speech.md всех кадров по порядку + правки из lines.json.
 * Если текст реплики изменился, подрезка сбрасывается (озвучка всё равно будет новая), место остаётся.
 * Места не-ручных реплик считаются заново (`durationOf` — длительность речи по озвучке, если она есть).
 * Ничего не пишет.
 */
export async function readPostLines(
  episodeId: string,
  options: {
    durationOf?: (line: PostLine) => number | null;
    finals?: Map<string, ShotFinal>;
    /** Рамка губ реплики (секунды от начала кадра): авто-место — её начало. */
    windowOf?: (line: PostLine) => Interval | null;
  } = {},
): Promise<{ lines: PostLine[]; finals: Map<string, ShotFinal> }> {
  const stored = readStored(episodeId);
  const resolveSpeaker = speakerResolver(episodeId);
  const finals = options.finals ?? new Map<string, ShotFinal>();
  const lines: PostLine[] = [];
  let order = 0;
  for (const shotId of activeShotIds(episodeId)) {
    const speech = parseSpeechLines(readShotSpeech(episodeId, shotId), readShotMeta(episodeId, shotId).characters);
    if (!speech.length) continue;
    if (!finals.has(shotId)) finals.set(shotId, await readShotFinal(episodeId, shotId));
    const shotLines: PostLine[] = speech.map((item) => {
      const id = `${shotId}-${item.index}`;
      const saved = stored.get(id);
      const sameText = saved?.text === item.text;
      order += 1;
      return {
        id,
        shotId,
        index: item.index,
        order,
        character: resolveSpeaker(item.character).character,
        speaker: item.character,
        text: item.text,
        at: finite(saved?.at),
        atManual: Boolean(saved?.atManual),
        trimIn: sameText ? finite(saved?.trimIn) : 0,
        trimOut: sameText ? finite(saved?.trimOut) : 0,
        speed: typeof saved?.speed === "number" && saved.speed > 0 ? saved.speed : null,
      };
    });
    const places = autoPlaceShot(shotLines, finals.get(shotId)?.sounds ?? null, (index) => {
      const line = shotLines[index];
      return options.durationOf?.(line) ?? estimateSpeechSec(line.text);
    });
    shotLines.forEach((line, index) => {
      const window = line.atManual ? null : options.windowOf?.(line);
      line.at = window ? Math.round(window.start * 1000) / 1000 : places[index];
    });
    lines.push(...shotLines);
  }
  return { lines, finals };
}

export function writePostLines(episodeId: string, lines: PostLine[]): void {
  const data: LinesFile = {
    updatedAt: new Date().toISOString(),
    lines: lines.map((line) => ({
      id: line.id,
      shotId: line.shotId,
      character: line.character,
      text: line.text,
      order: line.order,
      at: line.at,
      atManual: line.atManual,
      trimIn: line.trimIn,
      trimOut: line.trimOut,
      speed: line.speed,
    })),
  };
  writeJson(linesFile(episodeId), data);
}

export interface LinePatch {
  /** Число — ручное место; null — вернуть авто. */
  at?: number | null;
  trimIn?: number;
  trimOut?: number;
  /** Число — ручная скорость; null — вернуть авто. */
  speed?: number | null;
}

/** Правка реплики на доске. Пишет lines.json целиком (текущие реплики speech.md + правки). */
export async function updatePostLine(episodeId: string, id: string, patch: LinePatch): Promise<PostLine> {
  const { lines } = await readPostLines(episodeId);
  const line = lines.find((item) => item.id === id);
  if (!line) throw new Error(`Нет реплики ${id}`);
  const check = (value: number, label: string) => {
    if (!Number.isFinite(value) || Math.abs(value) > 600) throw new Error(`${label}: нужно число секунд`);
    return Math.round(value * 1000) / 1000;
  };
  if (patch.at === null) line.atManual = false;
  else if (patch.at !== undefined) {
    line.at = Math.max(0, check(patch.at, "Место"));
    line.atManual = true;
  }
  if (patch.trimIn !== undefined) line.trimIn = check(patch.trimIn, "Начало");
  if (patch.trimOut !== undefined) line.trimOut = check(patch.trimOut, "Конец");
  if (patch.speed === null) line.speed = null;
  else if (patch.speed !== undefined) {
    if (!Number.isFinite(patch.speed) || patch.speed < 0.5 || patch.speed > 2) throw new Error("Скорость: от 0.5 до 2");
    line.speed = Math.round(patch.speed * 100) / 100;
  }
  writePostLines(episodeId, lines);
  return line;
}
