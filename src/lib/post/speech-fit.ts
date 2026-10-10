import type { Interval } from "./ffmpeg";
import type { SpeechWord } from "./speech-detect";

/*
 * Подгонка озвучки под губы. Слова Whisper из финала кадра сопоставляются с репликами speech.md
 * по тексту (выравнивание последовательностей, порядок сохраняется): у реплики появляется рамка —
 * где её произносят губы. Озвучка ставится на начало рамки и ускоряется или замедляется до её длины.
 */

/** Пределы скорости: сильнее — звучит неестественно, такие реплики помечаются. */
export const MAX_SPEED = 1.35;
export const MIN_SPEED = 0.8;

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .split(/[^a-z0-9']+/)
    .map((word) => word.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = current;
    }
  }
  return row[b.length];
}

function similar(a: string, b: string): boolean {
  if (a === b) return true;
  const plainA = a.replace(/'/g, "");
  const plainB = b.replace(/'/g, "");
  if (plainA === plainB) return true;
  // Неточное совпадение — только для длинных слов: «here» и «there» — разные слова.
  if (Math.min(plainA.length, plainB.length) < 5) return false;
  return 1 - levenshtein(plainA, plainB) / Math.max(plainA.length, plainB.length) >= 0.75;
}

export interface LineWindow extends Interval {
  /** Сколько слов реплики нашлось в речи видео. */
  matched: number;
  total: number;
}

/**
 * Рамки реплик кадра по словам Whisper. Глобальное выравнивание: совпадение +2, пропуск слова
 * реплики −1, лишние слова Whisper бесплатно (шум, междометия). null — реплика в речи не нашлась.
 */
export function alignLinesToWords(lines: string[], words: SpeechWord[]): (LineWindow | null)[] {
  const a: { token: string; line: number }[] = [];
  lines.forEach((text, line) => tokens(text).forEach((token) => a.push({ token, line })));
  const b = words.map((word) => tokens(word.value).join(""));
  const n = a.length;
  const m = b.length;
  const score: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const move: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) {
    score[i][0] = -i;
    move[i][0] = 1;
  }
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const diagonal = similar(a[i - 1].token, b[j - 1]) ? score[i - 1][j - 1] + 2 : Number.NEGATIVE_INFINITY;
      const skipLine = score[i - 1][j] - 1;
      const skipWord = score[i][j - 1];
      const best = Math.max(diagonal, skipLine, skipWord);
      score[i][j] = best;
      move[i][j] = best === diagonal ? 0 : best === skipWord ? 2 : 1;
    }
  }
  const matchedWords: number[][] = lines.map(() => []);
  let i = n;
  let j = m;
  while (i > 0) {
    if (j > 0 && move[i][j] === 0) {
      matchedWords[a[i - 1].line].push(j - 1);
      i -= 1;
      j -= 1;
    } else if (j > 0 && move[i][j] === 2) {
      j -= 1;
    } else {
      i -= 1;
    }
  }
  return lines.map((text, line) => {
    const found = matchedWords[line].sort((x, y) => x - y);
    const total = tokens(text).length;
    if (!found.length || found.length < Math.max(1, Math.ceil(total * 0.4))) return null;
    return { start: words[found[0]].start, end: words[found[found.length - 1]].end, matched: found.length, total };
  });
}

export interface SpeedFit {
  /** Скорость клипа: >1 — быстрее. */
  speed: number;
  /** Нужная скорость без пределов: вне [MIN_SPEED, MAX_SPEED] — реплику стоит поправить. */
  wanted: number;
  clamped: boolean;
}

/** Скорость, при которой речь озвучки займёт рамку губ. */
export function fitSpeed(speechSec: number, windowSec: number): SpeedFit {
  if (!(speechSec > 0) || !(windowSec > 0.05)) return { speed: 1, wanted: 1, clamped: false };
  const wanted = speechSec / windowSec;
  const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, wanted));
  return { speed: Math.round(speed * 100) / 100, wanted: Math.round(wanted * 100) / 100, clamped: speed !== wanted };
}
