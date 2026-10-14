import path from "path";
import { collectPost, type LineVoiceStatus } from "./collect";
import { isolationCredits, type VoiceConfig } from "./elevenlabs";
import { postDir, TIMELINE_FPS } from "./paths";
import { listTimelines, readManifest, DEFAULT_SIZE } from "./timeline";
import type { SpeechStatus } from "./speech-detect";
import { readLatestVoiceJob, type VoiceJob } from "./voice-job";
import { listMusic, musicDir } from "./music";
import { latestProject, readLatestSubtitlesJob, renderDir, subtitleStylePath, type SubtitlesJob } from "./subtitles";
import fs from "fs";
import { listVoiceVersions, planCharacterVoice, readVoiceConfig } from "./voices";

/*
 * Что показывает секция «Пост» на доске. Только чтение.
 */

export interface PostLineView {
  id: string;
  shotId: string;
  order: number;
  character: string;
  text: string;
  at: number;
  atManual: boolean;
  trimIn: number;
  trimOut: number;
  /** Ручная скорость; null — авто. */
  speedManual: number | null;
  /** Где губы произносят реплику в кадре (секунды от начала кадра). */
  window: { start: number; end: number; matched: number; total: number } | null;
  voice: LineVoiceStatus;
  clip: {
    version: number;
    in: number;
    out: number;
    autoIn: number;
    autoOut: number;
    speechStart: number;
    speechEnd: number;
    speed: number;
    fit: { wanted: number; clamped: boolean } | null;
    /** Файл озвучки персонажа; отрезок играет страница. */
    url: string;
  } | null;
}

export interface PostCharacterView {
  name: string;
  lines: number;
  /** Реплик без актуальной озвучки (нет её или текст изменился). */
  pending: number;
  config: VoiceConfig | null;
  current: { version: number; createdAt: string; chars: number } | null;
  versions: number[];
  /** Символов уйдёт в ElevenLabs при озвучке (оценка стоимости); 0 — нет voice.json. */
  chars: number;
  /** Примерно кредитов Voice Isolator при новой озвучке (0 — очистка выключена). */
  isolationChars: number;
  /** Очистка текущей озвучки и сколько стоит очистить её сейчас. */
  isolation: { status: "done" | "error" | "off" | "none"; error: string | null; cleanCost: number };
}

export interface PostState {
  episodeId: string;
  fps: number;
  keyConfigured: boolean;
  lines: PostLineView[];
  characters: PostCharacterView[];
  shots: {
    shotId: string;
    hasFinal: boolean;
    duration: number | null;
    fps: number | null;
    hasAudio: boolean;
    /** Распознавание речи в финале (Whisper). */
    speech: { status: SpeechStatus; error: string | null; words: number; text: string };
  }[];
  timelines: { name: string; url: string }[];
  /** Проекты Kdenlive, по версиям. */
  projects: { name: string; url: string; path: string }[];
  manifest: {
    timeline: string;
    builtAt: string;
    width: number;
    height: number;
    lines: number;
    warnings: string[];
    skipped: { id: string; reason: string }[];
  } | null;
  defaultSize: { width: number; height: number };
  job: VoiceJob | null;
  /** Музыка эпизода (post/music) и куда её класть. */
  music: { dir: string; files: string[] };
  /** Субтитры: какой проект возьмёт «Добавить субтитры», есть ли стиль, последнее задание, рендеры. */
  subtitles: {
    project: string | null;
    styleFile: string;
    hasStyle: boolean;
    job: SubtitlesJob | null;
    renders: { name: string; url: string; path: string }[];
  };
}

export function postFileUrl(episodeId: string, relative: string, version?: number): string {
  const query = new URLSearchParams({ path: relative });
  if (version !== undefined) query.set("v", String(version));
  return `/api/episodes/${encodeURIComponent(episodeId)}/post/file?${query}`;
}

export async function getPostState(episodeId: string): Promise<PostState> {
  const { lines, finals, voices, speech } = await collectPost(episodeId);
  const root = postDir(episodeId);

  const names: string[] = [];
  for (const line of lines) if (line.character && !names.includes(line.character)) names.push(line.character);
  const characters = names.map((name): PostCharacterView => {
    const own = lines.filter((line) => line.character === name);
    const config = readVoiceConfig(name);
    const voice = voices.get(name.toLowerCase()) ?? null;
    return {
      name,
      lines: own.length,
      pending: own.filter((line) => line.voice !== "ok").length,
      config,
      current: voice ? { version: voice.version, createdAt: voice.createdAt, chars: voice.chars } : null,
      versions: listVoiceVersions(episodeId, name),
      chars: config ? planCharacterVoice(own, config).chars : 0,
      isolationChars: config ? planCharacterVoice(own, config).isolationChars : 0,
      isolation: {
        status: voice ? (voice.isolation?.status ?? "none") : "none",
        error: voice?.isolation?.error ?? null,
        cleanCost: voice && voice.isolation?.status !== "done" ? isolationCredits(voice.duration) : 0,
      },
    };
  });

  const manifest = readManifest(episodeId);
  return {
    episodeId,
    fps: TIMELINE_FPS,
    keyConfigured: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
    lines: lines.map((line) => ({
      id: line.id,
      shotId: line.shotId,
      order: line.order,
      character: line.character,
      text: line.text,
      at: line.at,
      atManual: line.atManual,
      trimIn: line.trimIn,
      trimOut: line.trimOut,
      speedManual: line.speed,
      window: line.window,
      voice: line.voice,
      clip: line.clip
        ? {
            version: line.clip.version,
            in: line.clip.in,
            out: line.clip.out,
            autoIn: line.clip.autoIn,
            autoOut: line.clip.autoOut,
            speechStart: line.clip.speechStart,
            speechEnd: line.clip.speechEnd,
            speed: line.clip.speed,
            fit: line.clip.fit,
            url: postFileUrl(episodeId, path.relative(root, line.clip.source).split(path.sep).join("/"), line.clip.version),
          }
        : null,
    })),
    characters,
    shots: [...finals.values()].map((final) => ({
      shotId: final.shotId,
      hasFinal: Boolean(final.file),
      duration: final.probe?.duration ?? null,
      fps: final.probe?.fps ?? null,
      hasAudio: Boolean(final.probe?.hasAudio),
      speech: (() => {
        const detected = speech.get(final.shotId);
        return {
          status: detected?.status ?? "none",
          error: detected?.error ?? null,
          words: detected?.words.length ?? 0,
          text: detected?.text ?? "",
        };
      })(),
    })),
    timelines: listTimelines(episodeId).map((name) => ({ name, url: postFileUrl(episodeId, `timeline/${name}`) })),
    projects: listTimelines(episodeId, ".kdenlive").map((name) => ({
      name,
      url: postFileUrl(episodeId, `timeline/${name}`),
      path: path.join(root, "timeline", name),
    })),
    manifest: manifest
      ? {
          timeline: manifest.timeline,
          builtAt: manifest.builtAt,
          width: manifest.width,
          height: manifest.height,
          lines: manifest.lines.length,
          warnings: manifest.warnings,
          skipped: manifest.skipped,
        }
      : null,
    defaultSize: manifest ? { width: manifest.width, height: manifest.height } : DEFAULT_SIZE,
    job: readLatestVoiceJob(episodeId),
    music: { dir: musicDir(episodeId), files: listMusic(episodeId).map((file) => path.basename(file)) },
    subtitles: {
      project: latestProject(episodeId),
      styleFile: subtitleStylePath(),
      hasStyle: fs.existsSync(subtitleStylePath()),
      job: readLatestSubtitlesJob(episodeId),
      renders: (() => {
        try {
          return fs
            .readdirSync(renderDir(episodeId))
            .filter((name) => name.endsWith(".mp4") && !name.endsWith(".part.mp4"))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map((name) => ({ name, url: postFileUrl(episodeId, `render/${name}`), path: path.join(renderDir(episodeId), name) }));
        } catch {
          return [];
        }
      })(),
    },
  };
}
