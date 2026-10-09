import path from "path";
import { readPostLines, type PostLine, type ShotFinal } from "./lines";
import { voicesDir } from "./paths";
import { readCurrentVoice, type VoiceLine, type VoiceVersion } from "./voices";

/*
 * Реплики вместе с текущей озвучкой персонажей: какой отрезок какого файла уйдёт в таймлайн.
 */

export type LineVoiceStatus = "ok" | "no-voice" | "stale" | "no-character";

export interface LineClip {
  /** Абсолютный путь `v{N}.wav`. */
  source: string;
  version: number;
  /** Отрезок файла с учётом подрезки. */
  in: number;
  out: number;
  /** Начало звука реплики в файле: оно ставится на `at`. */
  speechStart: number;
  speechEnd: number;
  /** Авто-границы без подрезки. */
  autoIn: number;
  autoOut: number;
}

export interface CollectedLine extends PostLine {
  voice: LineVoiceStatus;
  clip: LineClip | null;
}

export interface Collected {
  lines: CollectedLine[];
  finals: Map<string, ShotFinal>;
  voices: Map<string, VoiceVersion | null>;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export async function collectPost(episodeId: string, finals?: Map<string, ShotFinal>): Promise<Collected> {
  const voices = new Map<string, VoiceVersion | null>();
  const voiceOf = (character: string): VoiceVersion | null => {
    const key = character.toLowerCase();
    if (!voices.has(key)) {
      let voice: VoiceVersion | null = null;
      try {
        voice = character ? readCurrentVoice(episodeId, character) : null;
      } catch {
        voice = null;
      }
      voices.set(key, voice);
    }
    return voices.get(key) ?? null;
  };
  const voiceLine = (line: PostLine): { voice: VoiceVersion; item: VoiceLine } | null => {
    const voice = voiceOf(line.character);
    const item = voice?.lines.find((entry) => entry.id === line.id && entry.text === line.text);
    return voice && item ? { voice, item } : null;
  };
  const read = await readPostLines(episodeId, {
    finals,
    durationOf: (line) => {
      const found = voiceLine(line);
      return found ? found.item.speechEnd - found.item.speechStart : null;
    },
  });
  const lines = read.lines.map((line): CollectedLine => {
    if (!line.character) return { ...line, voice: "no-character", clip: null };
    const found = voiceLine(line);
    if (!found) return { ...line, voice: voiceOf(line.character) ? "stale" : "no-voice", clip: null };
    const { voice, item } = found;
    const start = Math.max(0, item.in + line.trimIn);
    const end = Math.min(voice.duration, Math.max(start + 0.05, item.out + line.trimOut));
    return {
      ...line,
      voice: "ok",
      clip: {
        source: path.join(voicesDir(episodeId, line.character), voice.file),
        version: voice.version,
        in: round(start),
        out: round(end),
        speechStart: item.speechStart,
        speechEnd: item.speechEnd,
        autoIn: item.in,
        autoOut: item.out,
      },
    };
  });
  return { lines, finals: read.finals, voices };
}
