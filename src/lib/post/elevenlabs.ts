import type { Alignment } from "./align";

/*
 * ElevenLabs Text to Speech с таймстемпами: POST /v1/text-to-speech/{voice_id}/with-timestamps.
 * https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
 * Ключ — ELEVENLABS_API_KEY (в .env.local, в git не попадает). Платно: каждый запрос списывает
 * символы, поэтому повторов здесь нет — их решает пользователь. ELEVENLABS_URL — другой адрес (тесты).
 */

/** Модель проекта: v3 понимает аудиотеги (`[strong Russian accent]`). */
export const DEFAULT_MODEL_ID = "eleven_v3";
export const OUTPUT_FORMAT = "mp3_44100_128";

export interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: number;
}

/** Тег v3 перед каждой фразой, если в voice.json поля `text_prefix` нет. */
export const DEFAULT_TEXT_PREFIX = "[strong Russian accent]";

/** `data/characters/{Name}/voice.json`. */
export interface VoiceConfig {
  voice_id: string;
  model_id: string;
  voice_settings?: VoiceSettings;
  seed?: number;
  /**
   * Дописывается перед каждой фразой персонажа при отправке (аудиотег v3), в текст реплик не попадает.
   * Пусто — без тега. Модели v2 теги не понимают и прочтут вслух.
   */
  text_prefix: string;
}

export function elevenBase(): string {
  return (process.env.ELEVENLABS_URL || "https://api.elevenlabs.io").replace(/\/$/, "");
}

export function elevenKey(): string {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) {
    throw new Error("Нет ключа ElevenLabs: впишите ELEVENLABS_API_KEY=… в .env.local в корне проекта и перезапустите доску.");
  }
  return key;
}

function statusText(status: number): string {
  if (status === 401) return "ключ ElevenLabs не принят (401)";
  if (status === 402) return "не хватает символов на тарифе ElevenLabs (402)";
  if (status === 422) return "ElevenLabs не принял параметры запроса (422)";
  if (status === 429) return "ElevenLabs: слишком много запросов (429)";
  return `HTTP ${status}`;
}

export interface TtsResult {
  audio: Buffer;
  alignment: Alignment;
  requestId: string | null;
}

export async function ttsWithTimestamps(
  config: VoiceConfig,
  text: string,
  context: { previousRequestIds?: string[]; previousText?: string } = {},
): Promise<TtsResult> {
  const body: Record<string, unknown> = { text, model_id: config.model_id };
  if (config.voice_settings) body.voice_settings = config.voice_settings;
  if (typeof config.seed === "number") body.seed = config.seed;
  if (context.previousRequestIds?.length) body.previous_request_ids = context.previousRequestIds.slice(-3);
  else if (context.previousText) body.previous_text = context.previousText;
  const url = `${elevenBase()}/v1/text-to-speech/${encodeURIComponent(config.voice_id)}/with-timestamps?output_format=${OUTPUT_FORMAT}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": elevenKey() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).trim().slice(0, 300);
    } catch {
      // без тела
    }
    throw new Error(`ElevenLabs: ${statusText(res.status)} ${detail}`.trim());
  }
  const data = (await res.json()) as { audio_base64?: string; alignment?: Alignment | null };
  if (!data.audio_base64) throw new Error("ElevenLabs: в ответе нет звука");
  if (!data.alignment?.characters?.length) throw new Error("ElevenLabs: в ответе нет таймстемпов");
  return {
    audio: Buffer.from(data.audio_base64, "base64"),
    alignment: data.alignment,
    requestId: res.headers.get("request-id"),
  };
}
