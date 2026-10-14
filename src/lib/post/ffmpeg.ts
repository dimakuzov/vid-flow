import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * ffmpeg/ffprobe из PATH (`FFMPEG` / `FFPROBE` — другой путь). Только чтение медиа и сборка wav озвучки.
 */

const FFMPEG = () => process.env.FFMPEG || "ffmpeg";
const FFPROBE = () => process.env.FFPROBE || "ffprobe";

function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const tail = String(stderr || "").trim().split(/\r?\n/).slice(-3).join(" ");
        reject(new Error(`${path.basename(command)}: ${tail || error.message}`));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export interface MediaProbe {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Кадров в секунду видео; 0 — нет видео. */
  fps: number;
  width: number;
  height: number;
  audioRate: number;
  audioChannels: number;
}

const probeCache = new Map<string, { mtime: number; probe: MediaProbe }>();

function parseRate(value: string | undefined): number {
  if (!value) return 0;
  const [num, den] = value.split("/").map(Number);
  if (!den) return num || 0;
  return num / den;
}

export async function probeMedia(file: string): Promise<MediaProbe> {
  const mtime = fs.statSync(file).mtimeMs;
  const cached = probeCache.get(file);
  if (cached && cached.mtime === mtime) return cached.probe;
  const { stdout } = await run(FFPROBE(), [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,r_frame_rate,width,height,sample_rate,channels:format=duration",
    "-of",
    "json",
    file,
  ]);
  const data = JSON.parse(stdout) as {
    streams?: { codec_type?: string; r_frame_rate?: string; width?: number; height?: number; sample_rate?: string; channels?: number }[];
    format?: { duration?: string };
  };
  const streams = data.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const probe: MediaProbe = {
    duration: Number(data.format?.duration) || 0,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    fps: parseRate(video?.r_frame_rate),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    audioRate: Number(audio?.sample_rate) || 0,
    audioChannels: audio?.channels ?? 0,
  };
  probeCache.set(file, { mtime, probe });
  return probe;
}

export interface Interval {
  start: number;
  end: number;
}

/** Порог тишины по умолчанию: речь ElevenLabs и звук финалов H3/HeyGen. */
export const SILENCE_NOISE_DB = -35;
export const SILENCE_MIN_SEC = 0.2;

const silenceCache = new Map<string, { mtime: number; silences: Interval[] }>();

/** Отрезки тишины звука файла (`silencedetect`). Тишина до конца файла закрывается его длительностью. */
export async function detectSilences(
  file: string,
  options: { noiseDb?: number; minSec?: number } = {},
): Promise<Interval[]> {
  const noise = options.noiseDb ?? SILENCE_NOISE_DB;
  const min = options.minSec ?? SILENCE_MIN_SEC;
  const key = `${file}|${noise}|${min}`;
  const mtime = fs.statSync(file).mtimeMs;
  const cached = silenceCache.get(key);
  if (cached && cached.mtime === mtime) return cached.silences;
  const { stderr } = await run(FFMPEG(), [
    "-hide_banner",
    "-nostats",
    "-i",
    file,
    "-vn",
    "-af",
    `silencedetect=noise=${noise}dB:d=${min}`,
    "-f",
    "null",
    "-",
  ]);
  const silences: Interval[] = [];
  let open: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) {
      open = Math.max(0, Number(start[1]));
      continue;
    }
    const end = line.match(/silence_end:\s*([\d.]+)/);
    if (end && open !== null) {
      silences.push({ start: open, end: Number(end[1]) });
      open = null;
    }
  }
  if (open !== null) {
    const { duration } = await probeMedia(file);
    silences.push({ start: open, end: Math.max(open, duration) });
  }
  silenceCache.set(key, { mtime, silences });
  return silences;
}

/** Звучащие отрезки: дополнение тишины до длительности файла. */
export function soundIntervals(silences: Interval[], duration: number): Interval[] {
  const sounds: Interval[] = [];
  let cursor = 0;
  for (const silence of [...silences].sort((a, b) => a.start - b.start)) {
    if (silence.start > cursor + 0.01) sounds.push({ start: cursor, end: silence.start });
    cursor = Math.max(cursor, silence.end);
  }
  if (duration > cursor + 0.01) sounds.push({ start: cursor, end: duration });
  return sounds;
}

/**
 * Склейка кусков озвучки в один wav (44.1 кГц, моно, PCM) с тишиной `gapSec` между кусками.
 * Ответ — где каждый кусок начинается в итоговом файле и его длительность.
 */
export async function joinToWav(
  inputs: string[],
  gapSec: number,
  output: string,
): Promise<{ offsets: number[]; durations: number[]; duration: number }> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-voice-"));
  try {
    const parts: string[] = [];
    const durations: number[] = [];
    for (const [index, input] of inputs.entries()) {
      const part = path.join(tmp, `part${index}.wav`);
      await run(FFMPEG(), ["-hide_banner", "-y", "-i", input, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", part]);
      parts.push(part);
      durations.push((await probeMedia(part)).duration);
    }
    const args = ["-hide_banner", "-y"];
    for (const part of parts) args.push("-i", part);
    const chain: string[] = [];
    const labels: string[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      labels.push(`[${index}:a]`);
      if (index < parts.length - 1 && gapSec > 0) {
        chain.push(`anullsrc=r=44100:cl=mono,atrim=duration=${gapSec}[g${index}]`);
        labels.push(`[g${index}]`);
      }
    }
    chain.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1[out]`);
    args.push("-filter_complex", chain.join(";"), "-map", "[out]", "-c:a", "pcm_s16le", "-ar", "44100", "-ac", "1");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const partial = `${output}.tmp.wav`;
    await run(FFMPEG(), [...args, partial]);
    fs.renameSync(partial, output);
    const offsets: number[] = [];
    let cursor = 0;
    for (const duration of durations) {
      offsets.push(cursor);
      cursor += duration + gapSec;
    }
    return { offsets, durations, duration: (await probeMedia(output)).duration };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Для тестов: звук из выражения `aevalsrc` (и, если надо, цветной кадр) в файл. */
export async function synthesizeMedia(
  output: string,
  options: { duration: number; expr: string; video?: { width: number; height: number; fps: number }; codec?: string },
): Promise<void> {
  const args = ["-hide_banner", "-y"];
  if (options.video) {
    const { width, height, fps } = options.video;
    args.push("-f", "lavfi", "-i", `color=c=gray:s=${width}x${height}:r=${fps}:d=${options.duration}`);
  }
  args.push("-f", "lavfi", "-i", `aevalsrc='${options.expr}':s=44100:d=${options.duration}`);
  if (options.video) args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest");
  if (options.codec) args.push("-c:a", options.codec);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await run(FFMPEG(), [...args, output]);
}

/** Звук в wav (44.1 кГц, моно) ровно заданной длины: короче — дополняется тишиной, длиннее — обрезается. */
export async function decodeToWavOfLength(input: string, output: string, duration: number): Promise<void> {
  const partial = `${output}.tmp.wav`;
  await run(FFMPEG(), [
    "-hide_banner",
    "-y",
    "-i",
    input,
    "-ac",
    "1",
    "-ar",
    "44100",
    "-af",
    "apad",
    "-t",
    duration.toFixed(6),
    "-c:a",
    "pcm_s16le",
    partial,
  ]);
  fs.renameSync(partial, output);
}
