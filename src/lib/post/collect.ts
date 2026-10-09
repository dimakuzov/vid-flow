import path from "path";
import { readShotMeta } from "../series/shot-meta";
import { readShotSpeech } from "../series/speech";
import { parseSpeechLines, readPostLines, type PostLine, type ShotFinal } from "./lines";
import { voicesDir } from "./paths";
import { readSpeechDetect, type ShotSpeech } from "./speech-detect";
import { alignLinesToWords, fitSpeed, type LineWindow } from "./speech-fit";
import { readCurrentVoice, type VoiceLine, type VoiceVersion } from "./voices";

/*
 * Реплики вместе с текущей озвучкой персонажей: какой отрезок какого файла уйдёт в таймлайн,
 * и, если в финале кадра распознана речь, — рамка губ и скорость, чтобы озвучка в неё уложилась.
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
  /** Скорость клипа (ручная или подгонка под губы); 1 — как есть. */
  speed: number;
  /** Подгонка под губы: нужная скорость и упёрлась ли она в предел. */
  fit: { wanted: number; clamped: boolean } | null;
}

export interface CollectedLine extends PostLine {
  voice: LineVoiceStatus;
  clip: LineClip | null;
  /** Где реплику произносят губы в финале кадра (секунды от начала кадра); null — не распознано. */
  window: LineWindow | null;
}

export interface Collected {
  lines: CollectedLine[];
  finals: Map<string, ShotFinal>;
  voices: Map<string, VoiceVersion | null>;
  speech: Map<string, ShotSpeech>;
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

  // Рамки губ по кадрам: слова Whisper ↔ реплики speech.md. Только свежее распознавание этого финала.
  const speech = new Map<string, ShotSpeech>();
  const windows = new Map<string, (LineWindow | null)[]>();
  const knownFinals = finals ?? new Map<string, ShotFinal>();
  const windowOf = (line: PostLine): LineWindow | null => {
    if (!windows.has(line.shotId)) {
      const detected = readSpeechDetect(episodeId, line.shotId, knownFinals.get(line.shotId) ?? null);
      speech.set(line.shotId, detected);
      const texts = parseSpeechLines(
        readShotSpeech(episodeId, line.shotId),
        readShotMeta(episodeId, line.shotId).characters,
      ).map((item) => item.text);
      windows.set(line.shotId, detected.status === "done" && detected.words.length ? alignLinesToWords(texts, detected.words) : []);
    }
    return windows.get(line.shotId)?.[line.index - 1] ?? null;
  };

  const read = await readPostLines(episodeId, {
    finals: knownFinals,
    windowOf: (line) => windowOf(line),
    durationOf: (line) => {
      const found = voiceLine(line);
      return found ? found.item.speechEnd - found.item.speechStart : null;
    },
  });
  // Кадры без реплик тоже показывают статус распознавания.
  for (const [shotId, final] of read.finals) {
    if (!speech.has(shotId)) speech.set(shotId, readSpeechDetect(episodeId, shotId, final));
  }

  const lines = read.lines.map((line): CollectedLine => {
    const window = windowOf(line);
    if (!line.character) return { ...line, voice: "no-character", clip: null, window };
    const found = voiceLine(line);
    if (!found) return { ...line, voice: voiceOf(line.character) ? "stale" : "no-voice", clip: null, window };
    const { voice, item } = found;
    const start = Math.max(0, item.in + line.trimIn);
    const end = Math.min(voice.duration, Math.max(start + 0.05, item.out + line.trimOut));
    const fit = window ? fitSpeed(item.speechEnd - item.speechStart, window.end - window.start) : null;
    return {
      ...line,
      voice: "ok",
      window,
      clip: {
        source: path.join(voicesDir(episodeId, line.character), voice.file),
        version: voice.version,
        in: round(start),
        out: round(end),
        speechStart: item.speechStart,
        speechEnd: item.speechEnd,
        autoIn: item.in,
        autoOut: item.out,
        speed: line.speed ?? fit?.speed ?? 1,
        fit: fit ? { wanted: fit.wanted, clamped: fit.clamped } : null,
      },
    };
  });
  return { lines, finals: read.finals, voices, speech };
}

