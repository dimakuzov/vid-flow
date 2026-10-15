import fs from "fs";
import path from "path";
import { getCharactersRoot } from "../series/paths";
import { chunkLines, isV3Model, locateLines, refineBounds, type LineBounds } from "./align";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_TEXT_PREFIX,
  isolateVoice,
  isolationCredits,
  ttsWithTimestamps,
  type VoiceConfig,
} from "./elevenlabs";
import { decodeToWavOfLength, detectSilences, joinToWav, probeMedia } from "./ffmpeg";
import { estimateSpeechSec, type PostLine } from "./lines";
import { characterKey, libraryCharacterDir, readJson, voicesDir, writeJson } from "./paths";

/*
 * Голос персонажа: настройки — `data/characters/{Name}/voice.json` (общие для всех эпизодов),
 * озвучка — `post/voices/{character}/v{N}.wav` + `v{N}.json` в эпизоде, `current.json` — версия в работе.
 * Один файл на персонажа со всеми его репликами: так голос не «плывёт» между репликами.
 */

export const VOICE_FILE = "voice.json";
/** Минимальная длина звука для Voice Isolator — 4.6 с; короче — дополняем тишиной до этой длины. */
export const ISOLATION_MIN_SEC = 5;
/** Тишина между кусками, если реплик персонажа больше, чем влезает в один запрос. */
export const CHUNK_GAP_SEC = 1;

export function voiceConfigPath(character: string): string | null {
  const dir = libraryCharacterDir(character);
  return dir ? path.join(dir, VOICE_FILE) : null;
}

export function readVoiceConfig(character: string): VoiceConfig | null {
  const file = voiceConfigPath(character);
  if (!file) return null;
  const data = readJson<Partial<VoiceConfig>>(file);
  if (!data || typeof data.voice_id !== "string" || !data.voice_id.trim()) return null;
  return {
    voice_id: data.voice_id.trim(),
    model_id: typeof data.model_id === "string" && data.model_id.trim() ? data.model_id.trim() : DEFAULT_MODEL_ID,
    voice_settings: data.voice_settings && typeof data.voice_settings === "object" ? data.voice_settings : undefined,
    seed: typeof data.seed === "number" ? data.seed : undefined,
    text_prefix: typeof data.text_prefix === "string" ? data.text_prefix.trim() : DEFAULT_TEXT_PREFIX,
    isolate: data.isolate !== false,
  };
}

/** Текст фразы, который уходит в ElevenLabs: тег персонажа + реплика. */
export function ttsLineText(config: VoiceConfig, text: string): string {
  return config.text_prefix ? `${config.text_prefix} ${text}` : text;
}

/** Форма на доске. Папки персонажа нет — создаётся `data/characters/{Name}/`. */
export function writeVoiceConfig(character: string, input: Partial<VoiceConfig>): VoiceConfig {
  const voiceId = typeof input.voice_id === "string" ? input.voice_id.trim() : "";
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(voiceId)) throw new Error("voice_id: скопируйте id голоса из ElevenLabs (латиница и цифры)");
  const modelId = typeof input.model_id === "string" && input.model_id.trim() ? input.model_id.trim() : DEFAULT_MODEL_ID;
  if (!/^[a-z0-9_]{3,64}$/.test(modelId)) throw new Error("model_id: например eleven_v3");
  const prefix = typeof input.text_prefix === "string" ? input.text_prefix.trim() : DEFAULT_TEXT_PREFIX;
  if (prefix.length > 200) throw new Error("Тег перед фразой: не длиннее 200 символов");
  const config: VoiceConfig = { voice_id: voiceId, model_id: modelId, text_prefix: prefix, isolate: input.isolate !== false };
  if (input.voice_settings && typeof input.voice_settings === "object") {
    const settings: Record<string, number | boolean> = {};
    for (const [key, value] of Object.entries(input.voice_settings)) {
      if (!["stability", "similarity_boost", "style", "speed", "use_speaker_boost"].includes(key)) continue;
      if (key === "use_speaker_boost") settings[key] = Boolean(value);
      else if (typeof value === "number" && Number.isFinite(value)) settings[key] = value;
    }
    if (Object.keys(settings).length) config.voice_settings = settings;
  }
  if (input.seed !== undefined && input.seed !== null) {
    const seed = Number(input.seed);
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error("seed: целое от 0 до 4294967295");
    config.seed = seed;
  }
  const dir = libraryCharacterDir(character) ?? path.join(getCharactersRoot(), characterKey(character));
  writeJson(path.join(dir, VOICE_FILE), config);
  return config;
}

export interface VoiceChunk {
  /** `v1.part1.mp3` — ответ ElevenLabs как есть. */
  file: string;
  requestId: string | null;
  text: string;
  lineIds: string[];
  /** Где кусок начинается в `v{N}.wav`. */
  offset: number;
  duration: number;
}

export interface VoiceLine extends LineBounds {
  id: string;
  text: string;
}

/** `post/voices/{character}/v{N}.json`. */
export interface VoiceVersion {
  version: number;
  character: string;
  createdAt: string;
  /** `v{N}.wav` — источник для таймлайна. */
  file: string;
  duration: number;
  config: VoiceConfig;
  /** Символов отправлено (оплачено). */
  chars: number;
  chunks: VoiceChunk[];
  lines: VoiceLine[];
  /** Звук до очистки (склейка ответов ElevenLabs); нет — `file` и есть исходник. */
  rawFile?: string;
  /** Voice Isolator: `done` — `file` очищен; `error` — очистка не удалась, `file` — исходник; `off` — выключена. */
  isolation?: { status: "done" | "error" | "off"; credits?: number; error?: string; at?: string };
}

interface CurrentFile {
  version: number;
  updatedAt: string;
}

export function listVoiceVersions(episodeId: string, character: string): number[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(voicesDir(episodeId, character));
  } catch {
    return [];
  }
  return names
    .map((name) => name.match(/^v(\d+)\.json$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number)
    .sort((a, b) => a - b);
}

export function readVoiceVersion(episodeId: string, character: string, version: number): VoiceVersion | null {
  return readJson<VoiceVersion>(path.join(voicesDir(episodeId, character), `v${version}.json`));
}

export function readCurrentVoice(episodeId: string, character: string): VoiceVersion | null {
  const current = readJson<CurrentFile>(path.join(voicesDir(episodeId, character), "current.json"));
  if (!current) return null;
  const version = readVoiceVersion(episodeId, character, current.version);
  if (!version || !fs.existsSync(path.join(voicesDir(episodeId, character), version.file))) return null;
  return version;
}

/** Сделать версию текущей (кнопка на доске — вернуться к прошлой озвучке). */
export function setCurrentVoice(episodeId: string, character: string, version: number): void {
  if (!readVoiceVersion(episodeId, character, version)) throw new Error(`Нет версии v${version} у ${character}`);
  writeJson(path.join(voicesDir(episodeId, character), "current.json"), { version, updatedAt: new Date().toISOString() });
}

/**
 * Текст, который уйдёт в ElevenLabs, и стоимость: символы озвучки и, если очистка включена,
 * примерные кредиты Voice Isolator (по оценке длины речи и пауз между репликами).
 */
export function planCharacterVoice(lines: PostLine[], config: VoiceConfig) {
  const chunks = chunkLines(
    lines.map((line) => ({ line, text: ttsLineText(config, line.text) })),
    config.model_id,
  );
  const seconds = lines.reduce((sum, line) => sum + estimateSpeechSec(line.text) + 1, 0);
  return {
    chunks,
    chars: chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
    isolationChars: config.isolate ? isolationCredits(seconds) : 0,
  };
}

/**
 * Voice Isolator по склейке озвучки: ответ (mp3) рядом как `{base}.isolated.mp3`, звук для таймлайна —
 * wav той же длины, что исходник, чтобы границы реплик не сдвинулись.
 */
async function cleanVoiceFile(dir: string, rawFile: string, cleanFile: string): Promise<number> {
  const raw = path.join(dir, rawFile);
  const { duration } = await probeMedia(raw);
  // Voice Isolator не берёт звук короче 4.6 с (audio_too_short): короткую озвучку дополняем тишиной,
  // ответ ниже всё равно обрезается до исходной длины.
  let upload = raw;
  if (duration < ISOLATION_MIN_SEC) {
    upload = path.join(dir, `${cleanFile.replace(/\.wav$/, "")}.padded.wav`);
    await decodeToWavOfLength(raw, upload, ISOLATION_MIN_SEC);
  }
  let isolated: Buffer;
  try {
    isolated = await isolateVoice(fs.readFileSync(upload), rawFile);
  } finally {
    if (upload !== raw) fs.rmSync(upload, { force: true });
  }
  const mp3 = `${cleanFile.replace(/\.wav$/, "")}.isolated.mp3`;
  fs.writeFileSync(path.join(dir, mp3), isolated);
  await decodeToWavOfLength(path.join(dir, mp3), path.join(dir, cleanFile), duration);
  return isolationCredits(duration);
}

/**
 * Озвучка персонажа новой версией: запросы по кускам (склейка через `previous_request_ids`,
 * для v3 — `previous_text`), куски — в один wav, границы реплик — по таймстемпам и тишине.
 * Ошибка посреди — уже оплаченные куски остаются на диске, версия не становится текущей.
 */
export async function generateCharacterVoice(
  episodeId: string,
  character: string,
  lines: PostLine[],
  onProgress: (text: string) => void = () => {},
): Promise<VoiceVersion> {
  const config = readVoiceConfig(character);
  if (!config) throw new Error(`У ${character} нет voice.json с voice_id`);
  if (!lines.length) throw new Error(`У ${character} нет реплик`);
  const dir = voicesDir(episodeId, character);
  fs.mkdirSync(dir, { recursive: true });
  const version = (listVoiceVersions(episodeId, character).pop() ?? 0) + 1;
  // Номер занят файлами без json (прошлая попытка упала): не затираем их.
  let free = version;
  while (fs.existsSync(path.join(dir, `v${free}.part1.mp3`))) free += 1;
  const name = `v${free}`;

  const { chunks, chars } = planCharacterVoice(lines, config);
  const v3 = isV3Model(config.model_id);
  const requestIds: string[] = [];
  const parts: { file: string; requestId: string | null; text: string; lineIds: string[]; located: { start: number; end: number }[] }[] = [];
  for (const [index, chunk] of chunks.entries()) {
    onProgress(`${character}: запрос ${index + 1} из ${chunks.length}`);
    const previous = chunks[index - 1];
    const result = await ttsWithTimestamps(config, chunk.text, {
      previousRequestIds: v3 ? undefined : requestIds,
      previousText: v3 && previous ? previous.text.slice(-500) : undefined,
    });
    const file = `${name}.part${index + 1}.mp3`;
    fs.writeFileSync(path.join(dir, file), result.audio);
    writeJson(path.join(dir, `${name}.part${index + 1}.json`), {
      requestId: result.requestId,
      text: chunk.text,
      alignment: result.alignment,
    });
    if (result.requestId) requestIds.push(result.requestId);
    parts.push({
      file,
      requestId: result.requestId,
      text: chunk.text,
      lineIds: chunk.items.map((item) => item.line.id),
      // Ищем саму реплику, без тега: тег не звучит, начало речи — первое слово.
      located: locateLines(result.alignment, chunk.items.map((item) => item.line.text)),
    });
  }

  onProgress(`${character}: склейка и границы реплик`);
  const wav = `${name}.wav`;
  const raw = config.isolate ? `${name}.raw.wav` : wav;
  const joined = await joinToWav(
    parts.map((part) => path.join(dir, part.file)),
    CHUNK_GAP_SEC,
    path.join(dir, raw),
  );
  // Очистка от шума и треска. Не удалась — озвучка уже оплачена: берём исходник и пишем ошибку.
  let isolation: VoiceVersion["isolation"] = { status: "off" };
  let file = raw;
  if (config.isolate) {
    onProgress(`${character}: очистка голоса (Voice Isolator)`);
    try {
      const credits = await cleanVoiceFile(dir, raw, wav);
      isolation = { status: "done", credits, at: new Date().toISOString() };
      file = wav;
    } catch (error) {
      isolation = { status: "error", error: error instanceof Error ? error.message : String(error), at: new Date().toISOString() };
    }
  }
  const speech = parts.flatMap((part, index) =>
    part.located.map((item) => ({ start: item.start + joined.offsets[index], end: item.end + joined.offsets[index] })),
  );
  const bounds = refineBounds(speech, await detectSilences(path.join(dir, file)), joined.duration);
  const data: VoiceVersion = {
    version: free,
    character,
    createdAt: new Date().toISOString(),
    file,
    rawFile: raw,
    isolation,
    duration: joined.duration,
    config,
    chars,
    chunks: parts.map((part, index) => ({
      file: part.file,
      requestId: part.requestId,
      text: part.text,
      lineIds: part.lineIds,
      offset: joined.offsets[index],
      duration: joined.durations[index],
    })),
    lines: lines.map((line, index) => ({ id: line.id, text: line.text, ...bounds[index] })),
  };
  writeJson(path.join(dir, `${name}.json`), data);
  setCurrentVoice(episodeId, character, free);
  return data;
}

/**
 * Очистить уже готовую текущую озвучку персонажа (Voice Isolator), без новой генерации.
 * Версия та же: исходник остаётся (`rawFile`), `file` — очищенный wav, границы реплик — по новой тишине.
 */
export async function isolateCurrentVoice(
  episodeId: string,
  character: string,
  onProgress: (text: string) => void = () => {},
): Promise<VoiceVersion> {
  const current = readCurrentVoice(episodeId, character);
  if (!current) throw new Error(`У ${character} нет озвучки`);
  if (current.isolation?.status === "done") return current;
  const dir = voicesDir(episodeId, character);
  const raw = current.rawFile ?? current.file;
  const clean = `v${current.version}.clean.wav`;
  onProgress(`${character}: очистка голоса (Voice Isolator)`);
  const credits = await cleanVoiceFile(dir, raw, clean);
  const speech = current.lines.map((line) => ({ start: line.speechStart, end: line.speechEnd }));
  const bounds = refineBounds(speech, await detectSilences(path.join(dir, clean)), current.duration);
  const updated: VoiceVersion = {
    ...current,
    file: clean,
    rawFile: raw,
    isolation: { status: "done", credits, at: new Date().toISOString() },
    lines: current.lines.map((line, index) => ({ ...line, ...bounds[index] })),
  };
  writeJson(path.join(dir, `v${current.version}.json`), updated);
  return updated;
}
