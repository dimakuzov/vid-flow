import fs from "fs";
import path from "path";
import { readJson } from "./paths";

/*
 * Что реально лежит в отредактированном проекте Kdenlive: клипы озвучки на дорожках, какой отрезок файла
 * каждый играет и, по `vN.json` рядом с файлом, какие реплики в этот отрезок попадают. Нужно субтитрам:
 * вырезанные в Kdenlive фразы в субтитры не идут, порядок — как на таймлайне.
 */

export interface ProjectLine {
  /** id реплики (`s05-2`) и её текст — как при озвучке (`vN.json`); у куска реплики — только его слова. */
  id: string;
  text: string;
  /** Где речь реплики (куска) начинается на таймлайне, секунды. */
  time: number;
  /** Слова и где они звучат на таймлайне (по таймстемпам озвучки): запасное время, если Whisper слово не услышал. */
  words: { text: string; time: number }[];
}

/** Время Kdenlive/MLT в кадрах: целое — кадры, `ЧЧ:ММ:СС.ммм` — время. */
export function parseMltTime(value: string | undefined, fps: number): number {
  if (!value) return 0;
  if (/^-?\d+$/.test(value)) return Number(value);
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return Math.round(parts.reduce((sum, part) => sum * 60 + part, 0) * fps);
}

function propertyOf(block: string, name: string): string | undefined {
  return block.match(new RegExp(`<property name="${name.replace(/[.]/g, "\\.")}">([^<]*)</property>`))?.[1];
}

const VOICE_FILE = /[\\/]voices[\\/][^\\/]+[\\/]v(\d+)(?:\.raw|\.clean)?\.wav$/i;

interface VoiceSource {
  file: string;
  speed: number;
}

/** Клипы озвучки по id продюсера: файл и скорость (`timewarp`). */
function voiceProducers(xml: string, root: string): Map<string, VoiceSource> {
  const result = new Map<string, VoiceSource>();
  for (const match of xml.matchAll(/<(chain|producer) id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    const [, , id, body] = match;
    const warp = propertyOf(body, "warp_resource");
    const resource = warp ?? propertyOf(body, "resource")?.replace(/^-?\d+(?:\.\d+)?:/, "");
    if (!resource) continue;
    const file = path.isAbsolute(resource) || /^[A-Za-z]:[\\/]/.test(resource) ? resource : path.join(root, resource);
    if (!VOICE_FILE.test(file)) continue;
    const speed = Number(propertyOf(body, "warp_speed") ?? 1);
    result.set(id, { file, speed: Number.isFinite(speed) && speed > 0 ? speed : 1 });
  }
  return result;
}

/** Запас по краю клипа, секунды: слово на самой границе ещё считается сыгранным. */
const EDGE_SLACK_SEC = 0.08;

interface WordTime {
  text: string;
  /** Начало и середина слова в файле озвучки, секунды. */
  start: number;
  middle: number;
}

/** Слова реплики по доле символов внутри её речи — если таймстемпов озвучки нет. */
export function estimateWordTimes(line: { text: string; speechStart: number; speechEnd: number }): WordTime[] {
  const length = Math.max(1, line.text.length);
  const span = Math.max(0.01, line.speechEnd - line.speechStart);
  return [...line.text.matchAll(/\S+/g)].map((match) => {
    const at = match.index ?? 0;
    return {
      text: match[0],
      start: line.speechStart + (span * at) / length,
      middle: line.speechStart + (span * (at + match[0].length / 2)) / length,
    };
  });
}

/** Слова, звучащие в отрезке файла [srcIn, srcOut] (по середине слова, с небольшим запасом на краю). */
export function wordsInRange(words: WordTime[], srcIn: number, srcOut: number): WordTime[] {
  return words.filter((word) => word.middle >= srcIn - EDGE_SLACK_SEC && word.middle <= srcOut + EDGE_SLACK_SEC);
}

interface VersionChunk {
  file: string;
  offset: number;
  lineIds: string[];
}

interface PartAlignment {
  alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
}

/**
 * Точное время слов реплик по таймстемпам ElevenLabs (`vN.partK.json` рядом с озвучкой, сдвиг куска — `offset`
 * в `vN.json`). Реплика ищется в тексте куска по порядку (перед ней может быть аудиотег персонажа).
 */
function alignedWordTimes(dir: string, version: VersionLines): Map<string, WordTime[]> {
  const result = new Map<string, WordTime[]>();
  for (const chunk of version.chunks ?? []) {
    const part = readJson<PartAlignment>(path.join(dir, chunk.file.replace(/\.mp3$/i, ".json")));
    const alignment = part?.alignment;
    if (!alignment?.characters?.length) continue;
    const joined = alignment.characters.join("");
    const index: number[] = [];
    alignment.characters.forEach((char, i) => {
      for (let k = 0; k < char.length; k += 1) index.push(i);
    });
    let cursor = 0;
    for (const id of chunk.lineIds) {
      const line = version.lines.find((item) => item.id === id);
      if (!line) continue;
      const at = joined.indexOf(line.text, cursor);
      if (at < 0) continue;
      cursor = at + line.text.length;
      const times: WordTime[] = [];
      for (const match of line.text.matchAll(/\S+/g)) {
        const first = index[at + (match.index ?? 0)];
        const last = index[at + (match.index ?? 0) + match[0].length - 1];
        const start = alignment.character_start_times_seconds[first] + chunk.offset;
        const end = alignment.character_end_times_seconds[last] + chunk.offset;
        times.push({ text: match[0], start, middle: (start + end) / 2 });
      }
      result.set(id, times);
    }
  }
  return result;
}

interface VersionLines {
  lines: { id: string; text: string; speechStart: number; speechEnd: number }[];
  chunks?: VersionChunk[];
}

/** Реплики, которые играют клипы озвучки проекта, по времени на таймлайне. */
export function projectVoiceLines(xml: string, fps: number): ProjectLine[] {
  const root = xml.match(/<mlt [^>]*\broot="([^"]*)"/)?.[1] ?? "";
  const producers = voiceProducers(xml, root);
  const versions = new Map<string, { version: VersionLines; words: Map<string, WordTime[]> } | null>();
  const versionOf = (file: string) => {
    const number = file.match(VOICE_FILE)?.[1];
    const json = path.join(path.dirname(file), `v${number}.json`);
    if (!versions.has(json)) {
      const version = fs.existsSync(json) ? readJson<VersionLines>(json) : null;
      versions.set(json, version ? { version, words: alignedWordTimes(path.dirname(file), version) } : null);
    }
    return versions.get(json) ?? null;
  };

  const found: ProjectLine[] = [];
  // Пустой плейлист — `<playlist id="x"/>`: его не открываем, иначе захватит соседний.
  for (const match of xml.matchAll(/<playlist id="([^"]+)"[^>]*?(?<!\/)>([\s\S]*?)<\/playlist>/g)) {
    const [, id, body] = match;
    if (id === "main_bin") continue;
    let cursor = 0;
    // Порядок атрибутов любой: доска пишет producer/in/out, Kdenlive при сохранении — in/out/producer.
    for (const item of body.matchAll(/<blank\s([^>]*?)\/?>|<entry\s([^>]*?)\/?>/g)) {
      const attrs = item[1] ?? item[2];
      const attr = (name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
      if (item[1] !== undefined) {
        cursor += parseMltTime(attr("length"), fps);
        continue;
      }
      const inFrame = parseMltTime(attr("in"), fps);
      const outFrame = parseMltTime(attr("out"), fps);
      const start = cursor;
      cursor += outFrame - inFrame + 1;
      const source = producers.get(attr("producer") ?? "");
      if (!source) continue;
      const known = versionOf(source.file);
      if (!known) continue;
      // Кадры timewarp — уже со скоростью: в секунды файла — умножить на скорость.
      const srcIn = (inFrame * source.speed) / fps;
      const srcOut = ((outFrame + 1) * source.speed) / fps;
      // Клип может играть кусок реплики (её резали в Kdenlive): берём только слова, которые попадают в отрезок файла.
      const toTimeline = (sourceTime: number) => Math.round((start / fps + (Math.max(srcIn, sourceTime) - srcIn) / source.speed) * 1000) / 1000;
      for (const line of known.version.lines) {
        const words = wordsInRange(known.words.get(line.id) ?? estimateWordTimes(line), srcIn, srcOut);
        if (!words.length) continue;
        found.push({
          id: line.id,
          text: words.map((word) => word.text).join(" "),
          time: toTimeline(words[0].start),
          words: words.map((word) => ({ text: word.text, time: toTimeline(word.start) })),
        });
      }
    }
  }
  return found
    .sort((a, b) => a.time - b.time)
    .filter((line, index, all) => index === 0 || !(all[index - 1].id === line.id && Math.abs(all[index - 1].time - line.time) < 0.05));
}
