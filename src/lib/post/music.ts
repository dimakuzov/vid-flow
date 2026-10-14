import fs from "fs";
import path from "path";
import { postDir } from "./paths";

/*
 * Музыка эпизода: файлы в `data/episodes/{ep}/post/music/` (mp3, wav, flac, m4a, ogg, aac).
 * Сборка оставляет в проекте пустую нижнюю дорожку «Музыка»; «Добавить субтитры» кладёт туда файлы по порядку
 * имён по кругу до конца проекта, а громкость (эффект Kdenlive «Volume») строит по речи, которую Whisper
 * услышал в отредактированном проекте: появление, приглушение под речью, затухание.
 */

export const MUSIC_EXTENSIONS = new Set([".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac"]);
/** Имя дорожки в проекте Kdenlive: сборка создаёт её пустой, «Добавить субтитры» заполняет. */
export const MUSIC_TRACK_NAME = "Музыка";
/** Громкость музыки без речи и под репликами, дБ. */
export const MUSIC_GAIN_DB = -18;
export const MUSIC_DUCK_DB = -28;
/** Появление в начале и затухание в конце, секунды; переход приглушения, секунды. */
export const MUSIC_FADE_IN_SEC = 1;
export const MUSIC_FADE_OUT_SEC = 2;
export const MUSIC_DUCK_RAMP_SEC = 0.3;
/** Паузы между репликами короче этой музыка не поднимает. */
const DUCK_MERGE_SEC = 1;
const SILENT_DB = -60;

export function musicDir(episodeId: string): string {
  return path.join(postDir(episodeId), "music");
}

export function listMusic(episodeId: string): string[] {
  try {
    return fs
      .readdirSync(musicDir(episodeId), { withFileTypes: true })
      .filter((entry) => entry.isFile() && MUSIC_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(musicDir(episodeId), entry.name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

/**
 * Ключевые кадры громкости музыки (кадр → дБ) для эффекта Volume: тишина → появление → под речью тише →
 * затухание к концу. `speech` — отрезки реплик в кадрах таймлайна.
 */
export function musicLevelKeyframes(totalFrames: number, speech: { start: number; end: number }[], fps: number): [number, number][] {
  const last = Math.max(1, totalFrames - 1);
  const fadeIn = Math.min(Math.round(MUSIC_FADE_IN_SEC * fps), Math.floor(last / 3));
  const fadeOutStart = Math.max(fadeIn, last - Math.round(MUSIC_FADE_OUT_SEC * fps));
  const ramp = Math.max(1, Math.round(MUSIC_DUCK_RAMP_SEC * fps));
  const merge = Math.round(DUCK_MERGE_SEC * fps);

  const ranges: { start: number; end: number }[] = [];
  for (const item of [...speech].sort((a, b) => a.start - b.start)) {
    const previous = ranges[ranges.length - 1];
    if (previous && item.start - previous.end <= merge) previous.end = Math.max(previous.end, item.end);
    else ranges.push({ start: item.start, end: item.end });
  }

  const points = new Map<number, number>();
  const set = (frame: number, db: number) => {
    if (frame < 0 || frame > last) return;
    points.set(frame, db);
  };
  set(0, SILENT_DB);
  set(fadeIn, MUSIC_GAIN_DB);
  for (const range of ranges) {
    const downStart = Math.max(fadeIn, range.start - ramp);
    const upEnd = Math.min(fadeOutStart, range.end + ramp);
    if (upEnd <= downStart) continue;
    set(downStart, points.get(downStart) ?? MUSIC_GAIN_DB);
    set(Math.max(downStart, range.start), MUSIC_DUCK_DB);
    set(Math.min(upEnd, Math.max(range.start, range.end)), MUSIC_DUCK_DB);
    set(upEnd, MUSIC_GAIN_DB);
  }
  set(fadeOutStart, points.get(fadeOutStart) ?? (ranges.some((r) => r.start <= fadeOutStart && r.end >= fadeOutStart) ? MUSIC_DUCK_DB : MUSIC_GAIN_DB));
  set(last, SILENT_DB);
  return [...points.entries()].sort((a, b) => a[0] - b[0]);
}
