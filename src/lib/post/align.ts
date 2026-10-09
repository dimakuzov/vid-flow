import type { Interval } from "./ffmpeg";

/*
 * Границы реплик в длинном файле персонажа: таймстемпы символов ElevenLabs (`/with-timestamps`)
 * дают, где реплика звучит; тишина (`silencedetect`) уточняет начало и конец звука.
 */

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Модели без SSML `<break>` и без склейки запросов (`previous_request_ids`). */
export function isV3Model(modelId: string): boolean {
  return /^eleven_v3/i.test(modelId);
}

/** Пауза между репликами в тексте запроса. v3 не понимает `<break>`: там пустая строка. */
export function lineSeparator(modelId: string): string {
  return isV3Model(modelId) ? "\n\n" : '\n<break time="1.0s" />\n';
}

/** Длина запроса по умолчанию: длинные генерации хуже держат голос; лимиты моделей больше. */
export function chunkLimit(): number {
  const configured = Number(process.env.POST_TTS_CHUNK_CHARS);
  return Number.isFinite(configured) && configured > 0 ? configured : 2500;
}

export interface TtsChunk<T> {
  items: T[];
  text: string;
}

/** Реплики подряд → куски не длиннее `limit` символов (реплика не режется). */
export function chunkLines<T extends { text: string }>(lines: T[], modelId: string, limit = chunkLimit()): TtsChunk<T>[] {
  const separator = lineSeparator(modelId);
  const chunks: TtsChunk<T>[] = [];
  let current: T[] = [];
  const textOf = (items: T[]) => items.map((item) => item.text).join(separator);
  for (const line of lines) {
    if (current.length && textOf([...current, line]).length > limit) {
      chunks.push({ items: current, text: textOf(current) });
      current = [];
    }
    current.push(line);
  }
  if (current.length) chunks.push({ items: current, text: textOf(current) });
  return chunks;
}

/**
 * Где каждая реплика звучит в ответе: ищем её текст по порядку в `alignment.characters`
 * (это исходный текст запроса). Начало — первый непробельный символ, конец — последний.
 */
export function locateLines(alignment: Alignment, texts: string[]): Interval[] {
  const chars = alignment.characters;
  const joined = chars.join("");
  // Склейка символов может быть длиннее числа элементов, если элемент — не один символ: держим карту.
  const charIndex: number[] = [];
  chars.forEach((char, index) => {
    for (let k = 0; k < char.length; k += 1) charIndex.push(index);
  });
  const result: Interval[] = [];
  let cursor = 0;
  for (const text of texts) {
    const needle = text.trim();
    let position = joined.indexOf(needle, cursor);
    let length = needle.length;
    if (position < 0) {
      // Запасной путь: без учёта регистра и повторных пробелов.
      const lower = joined.toLowerCase();
      const words = needle.toLowerCase().split(/\s+/).filter(Boolean);
      position = lower.indexOf(words[0] ?? "", cursor);
      const lastWord = words[words.length - 1] ?? "";
      const lastAt = position < 0 ? -1 : lower.indexOf(lastWord, position);
      if (position < 0 || lastAt < 0) throw new Error(`Не нашёл реплику в таймстемпах ElevenLabs: «${needle.slice(0, 60)}»`);
      length = lastAt + lastWord.length - position;
    }
    const first = charIndex[position];
    const last = charIndex[position + length - 1];
    result.push({
      start: alignment.character_start_times_seconds[first],
      end: alignment.character_end_times_seconds[last],
    });
    cursor = position + length;
  }
  return result;
}

/** Запас перед началом звука и после его конца, секунды. */
export const LEAD_SEC = 0.12;
export const TAIL_SEC = 0.2;
/** Насколько таймстемп может промахнуться мимо края тишины. */
const SLACK_SEC = 0.15;

export interface LineBounds {
  /** Начало звука реплики (по ней реплика ставится на место `at`). */
  speechStart: number;
  speechEnd: number;
  /** Отрезок файла, который уходит в таймлайн. */
  in: number;
  out: number;
}

/**
 * Границы отрезков: звук реплики уточняется по краям тишины, к нему добавляется запас,
 * но не дальше середины паузы до соседней реплики. Отрезки соседей не перекрываются.
 */
export function refineBounds(speech: Interval[], silences: Interval[], duration: number): LineBounds[] {
  const sorted = [...silences].sort((a, b) => a.start - b.start);
  const bounds = speech.map((item, index) => {
    const prevEnd = index > 0 ? speech[index - 1].end : 0;
    const nextStart = index < speech.length - 1 ? speech[index + 1].start : duration;
    // Тишина, которая кончается у начала реплики: её конец — настоящее начало звука.
    const before = sorted.filter((s) => s.end <= item.start + SLACK_SEC && s.end > prevEnd).pop();
    // Тишина, которая начинается у конца реплики: её начало — настоящий конец звука (выдох, затухание).
    const after = sorted.find((s) => s.start >= item.end - SLACK_SEC && s.start < nextStart);
    const speechStart = before ? Math.min(item.start, Math.max(before.end, prevEnd)) : item.start;
    const speechEnd = after ? Math.max(item.end, Math.min(after.start, nextStart)) : item.end;
    return { speechStart, speechEnd, in: 0, out: duration };
  });
  bounds.forEach((bound, index) => {
    const prev = bounds[index - 1];
    const next = bounds[index + 1];
    const lowLimit = prev ? (prev.speechEnd + bound.speechStart) / 2 : 0;
    const highLimit = next ? (bound.speechEnd + next.speechStart) / 2 : duration;
    bound.in = round(Math.max(lowLimit, bound.speechStart - LEAD_SEC));
    bound.out = round(Math.min(highLimit, bound.speechEnd + TAIL_SEC));
    bound.speechStart = round(bound.speechStart);
    bound.speechEnd = round(bound.speechEnd);
  });
  return bounds;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
