import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { enqueueComfyJob, readComfyJob } from "../comfy/queue";
import { getDataRoot, toPosix } from "../series/paths";
import { probeMedia } from "./ffmpeg";
import { jobsDir, postDir, readJson, TIMELINE_FPS, timelineDir, writeJson } from "./paths";
import { readSpeechGraph, speechGraphNodes, type SpeechWord } from "./speech-detect";
import { tokens } from "./speech-fit";
import { readManifest } from "./timeline";
import { projectVoiceLines } from "./project-read";
import { ensureKdenliveRenderPreset, kdenliveRenderFile, setProjectRenderSettings } from "./render-preset";
import { listMusic, musicLevelKeyframes } from "./music";
import { insertMusic, MusicTrackMissingError, speechFromWords } from "./music-insert";

/*
 * «Добавить субтитры»: последний проект Kdenlive эпизода (`post/timeline/{ep}_vN.kdenlive`, его правит пользователь)
 *   1. звук проекта — `melt` (движок Kdenlive) без окна;
 *   2. Whisper по нему — граф create_subtitles_file_from_video.json через очередь ComfyUI;
 *   3. пословные титры: время — Whisper, текст — реплики манифеста (speech.md), стиль — data/subtitles/style.ass;
 *   4. `{проект}.kdenlive.ass` рядом с проектом и ссылка на него в проекте (как делает сам Kdenlive), до правки — копия;
 *      музыка из post/music — в дорожку «Музыка», тише там, где Whisper услышал речь;
 *   5. рендер `melt`: H.264 1.6 Мбит/с, AAC → post/render/.
 */

export const SUBTITLE_STYLE_FILE = "style.ass";
/** Слово держится не меньше; паузу короче — заполняет предыдущее слово. */
const MIN_WORD_SEC = 0.25;
const FILL_GAP_SEC = 0.6;
export const RENDER_VIDEO_BITRATE = "1600k";
export const RENDER_AUDIO_BITRATE = "192k";

export function subtitleStylePath(): string {
  return path.join(getDataRoot(), "subtitles", SUBTITLE_STYLE_FILE);
}

export function renderDir(episodeId: string): string {
  return path.join(postDir(episodeId), "render");
}

/** Проект, который правит пользователь: последний `{ep}_vN.kdenlive` (без `_backup`, `.before-subs` и т.п.). */
export function latestProject(episodeId: string): string | null {
  let names: string[] = [];
  try {
    names = fs.readdirSync(timelineDir(episodeId));
  } catch {
    return null;
  }
  const pattern = new RegExp(`^${episodeId.replace(/[-]/g, "\\-")}_v(\\d+)\\.kdenlive$`);
  const best = names
    .map((name) => ({ name, version: Number(name.match(pattern)?.[1] ?? NaN) }))
    .filter((item) => Number.isFinite(item.version))
    .sort((a, b) => b.version - a.version)[0];
  return best ? path.join(timelineDir(episodeId), best.name) : null;
}

/** melt из Kdenlive: `MELT`, затем PATH, затем обычные папки установки Kdenlive. */
export function findMelt(): string {
  if (process.env.MELT && fs.existsSync(process.env.MELT)) return process.env.MELT;
  const roots = [
    "C:/Programs",
    "C:/Program Files",
    "C:/Program Files (x86)",
    path.join(os.homedir(), "Downloads"),
    path.join(os.homedir(), "AppData", "Local", "Programs"),
  ];
  for (const root of roots) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root).filter((name) => /kdenlive/i.test(name)).sort().reverse();
    } catch {
      continue;
    }
    for (const name of entries) {
      const candidate = path.join(root, name, "bin", "melt.exe");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const exe of ["melt.exe", "melt"]) {
      const candidate = path.join(dir, exe);
      if (dir && fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error("Не нашёл melt (движок Kdenlive): впишите MELT=…\\bin\\melt.exe в .env.local");
}

/** Запуск melt; прогресс — по «Current Position: N» из его вывода. */
function runMelt(args: string[], totalFrames: number, onProgress: (share: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(findMelt(), args, { windowsHide: true });
    let tail = "";
    const read = (chunk: Buffer) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-2000);
      const positions = [...text.matchAll(/Current Position:\s*(\d+)/g)];
      const last = positions[positions.length - 1];
      if (last && totalFrames > 0) onProgress(Math.min(1, Number(last[1]) / totalFrames));
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`melt завершился с кодом ${code}: ${tail.trim().split(/\r?\n/).slice(-3).join(" ")}`));
    });
  });
}

const mltPath = (file: string) => file.split(path.sep).join("/");

export interface WordCue {
  start: number;
  end: number;
  text: string;
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
  const x = a.replace(/'/g, "");
  const y = b.replace(/'/g, "");
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 5) return false;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length) >= 0.75;
}

/** Насколько слово Whisper может быть далеко от своего места в проекте, чтобы считаться им (секунды). */
const MATCH_WINDOW_SEC = 2;
/** Слово Whisper дальше этого от реплик — речь вне реплик (не «лишнее слово» внутри реплики). */
const EXTRA_MARGIN_SEC = 0.5;
/** Столько несопоставленных слов Whisper подряд — фраза вне реплик, даже рядом с репликой (не одно-два слова, услышанных иначе). */
const EXTRA_PHRASE_WORDS = 3;
/** Подряд не услышанных слов на краю реплики — столько и больше считаются вырезанными в проекте. */
const CUT_EDGE_WORDS = 2;

/**
 * Пословные титры: слова реплик (с пунктуацией, как в speech.md) выравниваются со словами Whisper по порядку;
 * время — от Whisper. Не услышанные слова внутри фразы делят время между соседями; два и больше подряд на краю
 * реплики (или вся реплика) — вырезаны в проекте и в титры не идут (`cut`).
 */
export type CueLine = string | { text: string; words?: { text: string; time: number }[] };

export function buildWordCues(
  lineInputs: CueLine[],
  words: SpeechWord[],
  options: { duration?: number } = {},
): { cues: WordCue[]; missing: string[]; cut: string[]; extra: string[] } {
  const lineTexts = lineInputs.map((line) => (typeof line === "string" ? line : line.text));
  let a: { token: string; shown: string; line: number; expected?: number; start?: number; end?: number }[] = [];
  lineInputs.forEach((input, line) => {
    const known = typeof input === "string" ? undefined : input.words;
    (typeof input === "string" ? input : input.text).split(/\s+/).forEach((piece, index) => {
      const parts = tokens(piece);
      if (!parts.length) return;
      // Время слова в проекте (по таймстемпам озвучки) — если Whisper его не услышит.
      const expected = known?.[index]?.text === piece ? known[index].time : undefined;
      a.push({ token: parts.join(""), shown: piece.replace(/^[.…]+/, ""), line, expected });
    });
  });
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
      // Слово с известным временем в проекте сопоставляется только с тем, что Whisper слышит рядом.
      const near = a[i - 1].expected === undefined || Math.abs(words[j - 1].start - a[i - 1].expected!) <= MATCH_WINDOW_SEC;
      const diagonal = near && similar(a[i - 1].token, b[j - 1]) ? score[i - 1][j - 1] + 2 : Number.NEGATIVE_INFINITY;
      const up = score[i - 1][j] - 1;
      const left = score[i][j - 1];
      const best = Math.max(diagonal, up, left);
      score[i][j] = best;
      move[i][j] = best === diagonal ? 0 : best === left ? 2 : 1;
    }
  }
  let i = n;
  let j = m;
  const usedWords = new Set<number>();
  const wordLine = new Map<number, number>();
  while (i > 0) {
    if (j > 0 && move[i][j] === 0) {
      a[i - 1].start = words[j - 1].start;
      a[i - 1].end = words[j - 1].end;
      usedWords.add(j - 1);
      wordLine.set(j - 1, a[i - 1].line);
      i -= 1;
      j -= 1;
    } else if (j > 0 && move[i][j] === 2) {
      j -= 1;
    } else {
      i -= 1;
    }
  }
  // Края реплик, которых не слышно, — вырезаны. Реплики из проекта (со временем слов) уже обрезаны по клипам — не трогаем.
  const cut: string[] = [];
  const drop = new Set<number>();
  for (let line = 0; line < lineTexts.length; line += 1) {
    if (typeof lineInputs[line] !== "string" && (lineInputs[line] as { words?: unknown[] }).words?.length) continue;
    const indices = a.map((item, index) => (item.line === line ? index : -1)).filter((index) => index >= 0);
    const heard = indices.filter((index) => a[index].start !== undefined);
    if (!heard.length) {
      indices.forEach((index) => drop.add(index));
      continue;
    }
    const leading = indices.filter((index) => index < heard[0]);
    const trailing = indices.filter((index) => index > heard[heard.length - 1]);
    if (leading.length >= CUT_EDGE_WORDS) leading.forEach((index) => drop.add(index));
    if (trailing.length >= CUT_EDGE_WORDS) trailing.forEach((index) => drop.add(index));
  }
  if (drop.size) {
    cut.push(...[...drop].sort((x, y) => x - y).map((index) => a[index].shown));
    a = a.filter((_, index) => !drop.has(index));
  }
  const missing = a.filter((item) => item.start === undefined).map((item) => item.shown);
  // Не услышанное слово с известным временем в проекте — на это время.
  for (const item of a) {
    if (item.start !== undefined || item.expected === undefined) continue;
    item.start = item.expected;
    item.end = item.expected + MIN_WORD_SEC;
  }
  for (let k = 0; k < a.length; ) {
    if (a[k].start !== undefined) {
      k += 1;
      continue;
    }
    let runEnd = k;
    while (runEnd < a.length && a[runEnd].start === undefined) runEnd += 1;
    const count = runEnd - k;
    const left = k > 0 ? a[k - 1].end! : runEnd < a.length ? Math.max(0, a[runEnd].start! - 0.3 * count) : 0;
    const right = runEnd < a.length ? a[runEnd].start! : left + 0.3 * count;
    const step = Math.max(0.05, (right - left) / count);
    for (let index = k; index < runEnd; index += 1) {
      a[index].start = left + step * (index - k);
      a[index].end = a[index].start! + step;
    }
    k = runEnd;
  }
  // Речь вне реплик (кадр, вставленный в Kdenlive со своим звуком): слова Whisper, которые не легли ни на одну реплику
  // и звучат вне отрезков реплик, — в титры его текстом.
  const spans = lineTexts
    .map((_, line) => a.filter((item) => item.line === line))
    .filter((items) => items.length)
    .map((items) => ({ start: Math.min(...items.map((item) => item.start!)), end: Math.max(...items.map((item) => item.end!)) }));
  const outside = (time: number) => spans.every((span) => time < span.start - EXTRA_MARGIN_SEC || time > span.end + EXTRA_MARGIN_SEC);
  // Слово Whisper между сопоставленными словами одной реплики — её слово, услышанное иначе («wanna» → «want to»).
  const ranges = new Map<number, { from: number; to: number }>();
  for (const [index, line] of wordLine) {
    const range = ranges.get(line);
    ranges.set(line, { from: Math.min(range?.from ?? index, index), to: Math.max(range?.to ?? index, index) });
  }
  const inLine = (index: number) => [...ranges.values()].some((range) => index > range.from && index < range.to);
  const candidates = words
    .map((word, index) => ({ start: word.start, end: word.end, shown: word.value.trim(), index }))
    .filter((word) => !usedWords.has(word.index) && word.shown && tokens(word.shown).length && !inLine(word.index));
  // Рядом с репликой Whisper может поставить чужую фразу в ту же точку («Oh dude, let's take it easy. This is my turn» —
  // всё на 66.5 с): EXTRA_PHRASE_WORDS и больше подряд идущих несопоставленных слов — речь вне реплик, где бы ни стояли.
  const phrase = new Set<number>();
  for (let k = 0; k < candidates.length; ) {
    let runEnd = k + 1;
    while (runEnd < candidates.length && candidates[runEnd].index === candidates[runEnd - 1].index + 1) runEnd += 1;
    if (runEnd - k >= EXTRA_PHRASE_WORDS) for (let index = k; index < runEnd; index += 1) phrase.add(candidates[index].index);
    k = runEnd;
  }
  const raw = candidates.filter((word) => phrase.has(word.index) || outside(word.start));
  // Порядок — как слышит Whisper; он иногда ставит много слов в одну точку. Каждое следующее слово — не раньше
  // предыдущего + MIN_WORD_SEC; кусок, не влезающий до следующего услышанного слова реплики (или конца звука),
  // сжимается равномерно — чужая фраза не перемешивается с репликой.
  const extras: { start: number; end: number; shown: string; index: number; pushed: boolean }[] = [];
  raw.forEach((word) => {
    const previous = extras[extras.length - 1];
    const pushed = Boolean(previous) && word.start < previous.start + MIN_WORD_SEC;
    const start = pushed ? previous.start + MIN_WORD_SEC : word.start;
    extras.push({ start, end: Math.max(word.end, start + MIN_WORD_SEC), shown: word.shown, index: word.index, pushed });
  });
  const used = [...usedWords].sort((x, y) => x - y);
  const end = options.duration !== undefined ? options.duration - 0.05 : Number.POSITIVE_INFINITY;
  for (let k = 0; k < extras.length; ) {
    const nextUsed = used.find((index) => index > extras[k].index);
    let runEnd = k + 1;
    while (runEnd < extras.length && used.find((index) => index > extras[runEnd].index) === nextUsed) runEnd += 1;
    const limit = Math.min(nextUsed !== undefined ? words[nextUsed].start : end, end);
    if (extras[runEnd - 1].end > limit) {
      // Сжимается только хвост, сдвинутый из одной точки, — с последнего слова, стоящего на своём времени.
      let first = runEnd - 1;
      while (first > k && extras[first].pushed) first -= 1;
      // Мало места — и на слитную речь перед ним (слово Whisper тянется до следующего).
      while (first > k && (limit - extras[first].start) / (runEnd - first) < MIN_WORD_SEC && extras[first - 1].end >= extras[first].start - 0.1) {
        first -= 1;
      }
      const from = Math.min(extras[first].start, limit - 0.06 * (runEnd - first));
      const step = Math.max(0.06, (limit - from) / (runEnd - first));
      for (let index = first; index < runEnd; index += 1) {
        extras[index].start = from + step * (index - first);
        extras[index].end = extras[index].start + step;
      }
    }
    k = runEnd;
  }

  // По времени: слово со своим временем из проекта может стоять не там, где его поставил порядок реплик.
  const items = [...a.map((item) => ({ start: item.start!, end: item.end!, shown: item.shown })), ...extras].sort((x, y) => x.start - y.start);
  const cues = items.map((item, index) => {
    const start = item.start;
    const next = items[index + 1]?.start;
    let end = Math.max(item.end, start + MIN_WORD_SEC);
    if (next !== undefined) {
      if (next - item.end < FILL_GAP_SEC) end = Math.max(end, next);
      end = Math.min(end, next);
    }
    return { start, end: Math.max(end, start + 0.04), text: item.shown };
  });
  return { cues, missing, cut, extra: extras.map((item) => item.shown) };
}

function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/**
 * Мягкая подложка под каждым словом: стиль «Box» (BorderStyle 3 — плашка, Outline — отступ вокруг букв, цвет — с
 * прозрачностью), текст в нём прозрачный; края размыты `\\blur`. Нет «Box» в шаблоне — из стиля текста с этими числами.
 * Затемнение 55 % (alpha 0x73), отступ 10 px, мягкость 16 — выбор пользователя по пробе на ep2.
 */
export const SUBTITLE_BOX_ALPHA = "73";
export const SUBTITLE_BOX_PAD = 10;
export const SUBTITLE_BOX_BLUR = 16;
export const SUBTITLE_BOX_STYLE = "Box";

/** Стиль «Box» из стиля текста: та же гарнитура и место, плашка вместо букв. */
export function boxStyleFrom(textStyle: string[]): string[] {
  const box = [...textStyle];
  box[0] = SUBTITLE_BOX_STYLE;
  box[3] = "&HFF000000";
  box[5] = `&H${SUBTITLE_BOX_ALPHA}000000`;
  box[6] = `&H${SUBTITLE_BOX_ALPHA}000000`;
  box[15] = "3";
  box[16] = SUBTITLE_BOX_PAD.toFixed(2);
  box[17] = "0.00";
  return box;
}

/**
 * ASS с шапкой и стилями из шаблона (всё до `[Events]`); нет шаблона — простой белый стиль. На каждое слово — два
 * события в одной точке: слой 0 — подложка (стиль «Box», размытые края), слой 1 — чёткий текст. Точка — из выравнивания
 * и отступов стиля текста; подложка сдвинута на свой отступ, чтобы стоять ровно под буквами.
 */
export function assDocument(
  template: string | null,
  cues: WordCue[],
  size: { width: number; height: number },
  options: { box?: boolean } = {},
): string {
  const fallback = `[Script Info]
ScriptType: v4.00+
PlayResX: ${size.width}
PlayResY: ${size.height}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3,0,2,40,40,230,1
`;
  const source = (template ?? fallback).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  let head = source.split(/^\[Events\]/m)[0].trimEnd();
  const styles = [...head.matchAll(/^Style:\s*(.+)$/gm)].map((match) => match[1].split(",").map((field) => field.trim()));
  const textStyle = styles.find((fields) => fields[0] !== SUBTITLE_BOX_STYLE) ?? styles[0];
  const style = textStyle?.[0] || "Default";
  const text = (cue: WordCue) => cue.text.replace(/\n/g, " ");
  const line = (layer: number, cue: WordCue, name: string, tags: string) =>
    `Dialogue: ${layer},${assTime(cue.start)},${assTime(cue.end)},${name},,0,0,0,,${tags}${text(cue)}`;

  if (options.box === false || !textStyle || textStyle.length < 22) {
    const events = cues.map((cue) => line(0, cue, style, ""));
    return `${head}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join("\n")}\n`;
  }

  let boxStyle = styles.find((fields) => fields[0] === SUBTITLE_BOX_STYLE);
  if (!boxStyle) {
    boxStyle = boxStyleFrom(textStyle);
    head = head.replace(/^(Style:\s*.+)$/m, `$1\nStyle: ${boxStyle.join(",")}`);
  }
  // Kdenlive показывает столько слоёв субтитров, сколько записано в MaxLayer.
  head = /^MaxLayer:/m.test(head) ? head.replace(/^MaxLayer:\s*\d+/m, "MaxLayer: 1") : head;

  const playX = Number(head.match(/^PlayResX:\s*(\d+)/m)?.[1] ?? size.width);
  const playY = Number(head.match(/^PlayResY:\s*(\d+)/m)?.[1] ?? size.height);
  const alignment = Number(textStyle[18]) || 2;
  const [marginL, marginR, marginV] = [Number(textStyle[19]) || 0, Number(textStyle[20]) || 0, Number(textStyle[21]) || 0];
  const column = (alignment - 1) % 3; // 0 — слева, 1 — по центру, 2 — справа
  const row = Math.floor((alignment - 1) / 3); // 0 — снизу, 1 — посередине, 2 — сверху
  const x = column === 0 ? marginL : column === 2 ? playX - marginR : Math.round(playX / 2);
  const y = row === 0 ? playY - marginV : row === 2 ? marginV : Math.round(playY / 2);
  const pad = Number(boxStyle[16]) || SUBTITLE_BOX_PAD;
  const boxX = column === 0 ? x - pad : column === 2 ? x + pad : x;
  const boxY = row === 0 ? y + pad : row === 2 ? y - pad : y;

  const events = cues.flatMap((cue) => [
    line(0, cue, SUBTITLE_BOX_STYLE, `{\\an${alignment}\\pos(${boxX},${boxY})\\blur${SUBTITLE_BOX_BLUR}}`),
    line(1, cue, style, `{\\an${alignment}\\pos(${x},${y})}`),
  ]);
  return `${head}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join("\n")}\n`;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Последовательность, открытая в проекте: `kdenlive:docproperties.activetimeline` — её uuid. Kdenlive при сохранении
 * переименовывает тракторы (`tractor6`), uuid остаётся свойством `kdenlive:uuid` внутри; у собранного доской id = uuid.
 */
export function sequenceBlock(xml: string): { open: number; close: number } {
  const active = xml.match(/<property name="kdenlive:docproperties\.activetimeline">([^<]+)<\/property>/)?.[1];
  if (!active) throw new Error("В проекте нет активной последовательности (kdenlive:docproperties.activetimeline)");
  let open = xml.indexOf(`<tractor id="${active}"`);
  if (open < 0) {
    const marker = xml.indexOf(`<property name="kdenlive:uuid">${active}</property>`);
    if (marker >= 0) open = xml.lastIndexOf("<tractor ", marker);
  }
  if (open < 0) throw new Error(`В проекте нет последовательности ${active}`);
  return { open, close: xml.indexOf("</tractor>", open) };
}

/** Длина последовательности в кадрах: `out` трактора — кадры или время `ЧЧ:ММ:СС.ммм`. */
export function sequenceFrames(xml: string, fps = TIMELINE_FPS): number {
  const { open } = sequenceBlock(xml);
  const out = xml.slice(open, xml.indexOf(">", open)).match(/\bout="([^"]+)"/)?.[1];
  if (!out) return 0;
  if (/^\d+$/.test(out)) return Number(out) + 1;
  const parts = out.split(":").map(Number);
  const seconds = parts.reduce((sum, value) => sum * 60 + value, 0);
  return Number.isFinite(seconds) ? Math.round(seconds * fps) + 1 : 0;
}

/**
 * Дорожка субтитров в проекте Kdenlive — так её пишет сам Kdenlive 26.08: в последовательности
 * `kdenlive:sequenceproperties.subtitlesList` (файл .ass) и фильтр `avfilter.subtitles` с этим файлом.
 */
export function patchProjectSubtitles(xml: string, assFile: string): string {
  const { open, close } = sequenceBlock(xml);
  let block = xml.slice(open, close);
  const file = xmlEscape(mltPath(assFile));
  const list = xmlEscape(JSON.stringify([{ file: mltPath(assFile), id: 0, name: "Subtitles" }], null, 4));
  const listProperty = `<property name="kdenlive:sequenceproperties.subtitlesList">${list}\n</property>`;
  if (/<property name="kdenlive:sequenceproperties\.subtitlesList">[\s\S]*?<\/property>/.test(block)) {
    block = block.replace(/<property name="kdenlive:sequenceproperties\.subtitlesList">[\s\S]*?<\/property>/, listProperty);
  } else {
    block = block.replace(/(<tractor [^>]*>\s*)/, `$1${listProperty}\n  `);
  }
  if (/<property name="kdenlive:sequenceproperties\.hidesubtitle">[^<]*<\/property>/.test(block)) {
    block = block.replace(
      /(<property name="kdenlive:sequenceproperties\.hidesubtitle">)[^<]*(<\/property>)/,
      (_, open: string, close: string) => `${open}0${close}`,
    );
  }
  const filterPattern = /<filter id="[^"]*">(?:(?!<\/filter>)[\s\S])*?<property name="mlt_service">avfilter\.subtitles<\/property>[\s\S]*?<\/filter>/;
  const filter = `<filter id="filter_subtitles">
   <property name="mlt_service">avfilter.subtitles</property>
   <property name="av.alpha">1</property>
   <property name="internal_added">237</property>
   <property name="av.filename">${file}</property>
  </filter>`;
  if (filterPattern.test(block)) block = block.replace(filterPattern, filter);
  else block = `${block.trimEnd()}\n  ${filter}\n `;
  return xml.slice(0, open) + block + xml.slice(close);
}

export type SubtitlesStatus = "pending" | "running" | "done" | "error";

/** `post/jobs/subs-*.json`. */
export interface SubtitlesJob {
  id: string;
  kind: "subtitles";
  episodeId: string;
  /** Путь проекта от папки поста: `timeline/ep2_v5.kdenlive`. */
  project: string;
  status: SubtitlesStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress?: string;
  /** Файлы от папки поста: субтитры, копия проекта до правки, рендер. */
  ass?: string;
  backup?: string;
  render?: string;
  words?: number;
  /** Реплик в субтитрах и откуда тексты: из клипов проекта или (если не нашлись) из сборки. */
  lines?: number;
  linesFrom?: "project" | "manifest";
  /** Слова на краях реплик, которых нет в звуке проекта: вырезаны, в субтитры не пошли. */
  cut?: string[];
  /** Речь вне реплик (вставленные в Kdenlive куски со своим звуком): в субтитрах текстом Whisper. */
  extra?: string[];
  /** Музыка, положенная в проект (имена файлов из post/music), или почему её нет. */
  music?: string[];
  musicNote?: string;
  missing?: string[];
  error?: string;
}

const ACTIVE = "__frameboardSubtitleJobs";
function active(): Set<string> {
  const g = globalThis as typeof globalThis & { [ACTIVE]?: Set<string> };
  if (!g[ACTIVE]) g[ACTIVE] = new Set();
  return g[ACTIVE]!;
}

function jobFile(episodeId: string, id: string): string {
  return path.join(jobsDir(episodeId), `${id}.json`);
}

const fromPost = (episodeId: string, file: string) => toPosix(path.relative(postDir(episodeId), file));

export function readLatestSubtitlesJob(episodeId: string): SubtitlesJob | null {
  let names: string[] = [];
  try {
    names = fs.readdirSync(jobsDir(episodeId)).filter((name) => /^subs-.+\.json$/.test(name));
  } catch {
    return null;
  }
  const job = names
    .map((name) => readJson<SubtitlesJob>(path.join(jobsDir(episodeId), name)))
    .filter((item): item is SubtitlesJob => Boolean(item))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .pop();
  if (job && (job.status === "pending" || job.status === "running") && !active().has(job.id)) {
    return { ...job, status: "error", error: `Прервалось (доска перезапускалась) на шаге «${job.progress ?? "начало"}» — нажмите ещё раз` };
  }
  return job ?? null;
}

/** «Добавить субтитры»: бесплатно (локальный ComfyUI и melt). Ответ сразу; работа — `runSubtitlesJob`. */
export function enqueueSubtitlesJob(episodeId: string): SubtitlesJob {
  const project = latestProject(episodeId);
  if (!project) throw new Error("Нет проекта Kdenlive — сначала «Собрать проект»");
  if (!readManifest(episodeId)) throw new Error("Нет манифеста сборки — сначала «Собрать проект»");
  const running = readLatestSubtitlesJob(episodeId);
  if (running && (running.status === "pending" || running.status === "running")) throw new Error("Субтитры уже делаются — дождитесь");
  const now = new Date();
  const job: SubtitlesJob = {
    id: `subs-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(2).toString("hex")}`,
    kind: "subtitles",
    episodeId,
    project: fromPost(episodeId, project),
    status: "pending",
    createdAt: now.toISOString(),
  };
  active().add(job.id);
  writeJson(jobFile(episodeId, job.id), job);
  return job;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface SubtitlesOptions {
  /** Ждать Whisper не дольше, мс (20 мин); задание, не ушедшее в ComfyUI, — не дольше stallMs (90 с). */
  timeoutMs?: number;
  stallMs?: number;
  pollMs?: number;
  /** Без финального рендера (тесты, быстрая проверка). */
  skipRender?: boolean;
}

/** Ждёт задание Whisper и возвращает слова. */
async function waitForWords(jobId: string, options: SubtitlesOptions): Promise<SpeechWord[]> {
  const started = Date.now();
  for (;;) {
    const job = readComfyJob(jobId);
    if (!job) throw new Error("Задание Whisper пропало из очереди");
    if (job.status === "done") {
      const nodes = speechGraphNodes(readSpeechGraph());
      const name = (job.files ?? []).find((file) => file === `${nodes.words}.txt` || file.startsWith(`${nodes.words}-`));
      if (!name) throw new Error("Whisper не вернул слова");
      const raw = fs.readFileSync(path.join(path.resolve(process.cwd(), job.saveTo), name), "utf8");
      return (JSON.parse(raw) as SpeechWord[]).filter((word) => typeof word.value === "string" && Number.isFinite(word.start));
    }
    if (job.status === "error" || job.status === "cancelled") throw new Error(`Whisper: ${job.error ?? "отменено"}`);
    const neverSent = job.status === "pending" && !job.submittedAt;
    if (neverSent && Date.now() - started > (options.stallMs ?? 90_000)) {
      throw new Error("Задание Whisper не ушло в ComfyUI — запущен ли он?");
    }
    if (Date.now() - started > (options.timeoutMs ?? 20 * 60_000)) throw new Error("Whisper не успел за 20 минут");
    await sleep(options.pollMs ?? 2000);
  }
}

export async function runSubtitlesJob(episodeId: string, id: string, options: SubtitlesOptions = {}): Promise<SubtitlesJob> {
  const file = jobFile(episodeId, id);
  let job = readJson<SubtitlesJob>(file);
  if (!job) throw new Error(`Нет задания ${id}`);
  if (job.status !== "pending") return job;
  active().add(id);
  const save = (patch: Partial<SubtitlesJob>) => {
    job = { ...job!, ...patch };
    writeJson(file, job);
  };
  save({ status: "running", startedAt: new Date().toISOString(), progress: "звук проекта" });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-subs-"));
  try {
    const post = postDir(episodeId);
    const project = path.join(post, job.project);
    const manifest = readManifest(episodeId)!;
    let totalFrames = Math.max(1, Math.round(manifest.duration * TIMELINE_FPS));
    try {
      totalFrames = sequenceFrames(fs.readFileSync(project, "utf8")) || totalFrames;
    } catch {
      // длина нужна только для процентов
    }
    const base = path.basename(project, ".kdenlive");
    const subsDir = path.join(post, "subtitles");
    fs.mkdirSync(subsDir, { recursive: true });

    // 1. Звук проекта (как его правил пользователь) и крошечное видео с ним для загрузчика Whisper-графа.
    const audio = path.join(work, "audio.wav");
    await runMelt(
      [`xml:${mltPath(project)}`, "-consumer", `avformat:${mltPath(audio)}`, "video_off=1", "acodec=pcm_s16le", "ar=16000", "ac=1", "real_time=-1"],
      totalFrames,
      (share) => save({ progress: `звук проекта ${Math.round(share * 100)}%` }),
    );
    const carrier = path.join(subsDir, `${base}.whisper.mp4`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.env.FFMPEG || "ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=black:s=64x64:r=1",
        "-i", audio, "-shortest", "-c:v", "libx264", "-tune", "stillimage", "-c:a", "aac", "-b:a", "96k", carrier,
      ], { windowsHide: true });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg завершился с кодом ${code}`))));
    });

    // 2. Whisper через очередь доски.
    save({ progress: "распознавание речи (Whisper)" });
    const graph = readSpeechGraph();
    const nodes = speechGraphNodes(graph);
    const upload = `fb_${episodeId}_${base}_subs.mp4`;
    graph[nodes.load].inputs.video = upload;
    const whisperId = `post-subs-${episodeId}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(2).toString("hex")}`.slice(0, 81);
    enqueueComfyJob({
      id: whisperId,
      status: "pending",
      episodeId,
      workflow: "speech_detect",
      prompt: graph,
      uploads: [{ path: toPosix(path.relative(process.cwd(), carrier)), filename: upload }],
      saveTo: toPosix(path.relative(process.cwd(), path.join(subsDir, whisperId))),
      saveText: true,
    });
    const words = await waitForWords(whisperId, options);

    // 3. Пословные титры со стилем шаблона.
    save({ progress: "субтитры" });
    // Реплики — те, что реально лежат в проекте (вырезанные в Kdenlive не попадут), по месту на таймлайне.
    const inProject = projectVoiceLines(fs.readFileSync(project, "utf8"), TIMELINE_FPS);
    const linesFrom: "project" | "manifest" = inProject.length ? "project" : "manifest";
    const lineTexts = inProject.length
      ? inProject.map((line) => line.text)
      : [...manifest.lines].sort((x, y) => x.timelineStart - y.timelineStart).map((line) => line.text);
    const { cues, missing, cut, extra } = buildWordCues(inProject.length ? inProject : lineTexts, words, {
      duration: totalFrames / TIMELINE_FPS,
    });
    const template = fs.existsSync(subtitleStylePath()) ? fs.readFileSync(subtitleStylePath(), "utf8") : null;
    const ass = `${project}.ass`;
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    if (fs.existsSync(ass)) fs.copyFileSync(ass, `${project}.before-subs-${stamp}.ass`);
    fs.writeFileSync(ass, assDocument(template, cues, { width: manifest.width, height: manifest.height }), "utf8");

    // 4. Ссылка на субтитры в проекте; до правки — копия проекта.
    const backup = path.join(path.dirname(project), `${base}.before-subs-${stamp}.kdenlive`);
    fs.copyFileSync(project, backup);
    let patched = patchProjectSubtitles(fs.readFileSync(project, "utf8"), ass);

    // Музыка из post/music — в дорожку «Музыка»; тише там, где Whisper услышал речь в этом проекте.
    const musicFiles = listMusic(episodeId);
    let music: string[] = [];
    let musicNote: string | undefined;
    if (musicFiles.length) {
      save({ progress: "музыка" });
      const sources = await Promise.all(
        musicFiles.map(async (file) => ({
          file,
          frames: Math.max(1, Math.ceil((await probeMedia(file)).duration * TIMELINE_FPS)),
          label: `Музыка: ${path.basename(file)}`,
        })),
      );
      const level = musicLevelKeyframes(totalFrames, speechFromWords(words, TIMELINE_FPS), TIMELINE_FPS)
        .map(([frame, db]) => `${frame}=${db}`)
        .join(";");
      try {
        patched = insertMusic(patched, sources, totalFrames, level);
        music = musicFiles.map((file) => path.basename(file));
      } catch (error) {
        if (!(error instanceof MusicTrackMissingError)) throw error;
        musicNote = error.message;
      }
    }
    patched = setProjectRenderSettings(patched, kdenliveRenderFile(episodeId, project));
    try {
      ensureKdenliveRenderPreset();
    } catch (error) {
      console.error("[frameboard] пресет рендера Kdenlive:", error);
    }
    fs.writeFileSync(`${project}.tmp`, patched, "utf8");
    fs.renameSync(`${project}.tmp`, project);
    save({
      ass: fromPost(episodeId, ass),
      backup: fromPost(episodeId, backup),
      words: cues.length,
      lines: lineTexts.length,
      linesFrom,
      missing,
      cut,
      extra,
      music,
      musicNote,
    });

    // 5. Рендер проекта с субтитрами.
    if (!options.skipRender) {
      fs.mkdirSync(renderDir(episodeId), { recursive: true });
      let n = 1;
      while (fs.existsSync(path.join(renderDir(episodeId), `${base}_r${n}.mp4`))) n += 1;
      const output = path.join(renderDir(episodeId), `${base}_r${n}.mp4`);
      const partial = `${output}.part.mp4`;
      await runMelt(
        [
          `xml:${mltPath(project)}`,
          "-consumer",
          `avformat:${mltPath(partial)}`,
          "vcodec=libx264",
          `vb=${RENDER_VIDEO_BITRATE}`,
          "preset=medium",
          "pix_fmt=yuv420p",
          "acodec=aac",
          `ab=${RENDER_AUDIO_BITRATE}`,
          "ar=48000",
          "ac=2",
          "movflags=+faststart",
          "real_time=-1",
        ],
        totalFrames,
        (share) => save({ progress: `рендер ${Math.round(share * 100)}%` }),
      );
      fs.renameSync(partial, output);
      const probe = await probeMedia(output);
      if (!probe.hasVideo) throw new Error("Рендер без видео");
      save({ render: fromPost(episodeId, output) });
    }
    save({ status: "done", progress: undefined, finishedAt: new Date().toISOString() });
  } catch (error) {
    save({ status: "error", error: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() });
  } finally {
    active().delete(id);
    fs.rmSync(work, { recursive: true, force: true });
  }
  return job;
}
