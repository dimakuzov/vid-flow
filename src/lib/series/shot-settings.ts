import fs from "fs";
import path from "path";
import { shotDir } from "./paths";
import { writeText } from "./media";

/*
 * Настройки кадра, общие для нескольких этапов. `shots/{shotId}/shot_settings.json`. Пишет только доска.
 * strictFirstFrame — «Строго первый кадр»: графы MiniMax превью и финала закрепляют утверждённый
 * первый кадр на нулевом кадре видео (вход манифеста с `whenShot: "strictFirstFrame"`).
 * Нет файла или false — MiniMax сам выбирает план.
 */

export const SHOT_SETTINGS_FILE = "shot_settings.json";

export interface ShotSettings {
  strictFirstFrame?: boolean;
}

export type ShotSettingKey = keyof ShotSettings;

function settingsPath(episodeId: string, shotId: string): string {
  return path.join(shotDir(episodeId, shotId), SHOT_SETTINGS_FILE);
}

export function readShotSettings(episodeId: string, shotId: string): ShotSettings {
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath(episodeId, shotId), "utf8")) as Record<string, unknown>;
    return data.strictFirstFrame === true ? { strictFirstFrame: true } : {};
  } catch {
    return {};
  }
}

export function shotSettingOn(episodeId: string, shotId: string, key: ShotSettingKey): boolean {
  return readShotSettings(episodeId, shotId)[key] === true;
}

export function setStrictFirstFrame(episodeId: string, shotId: string, on: boolean): ShotSettings {
  if (!fs.existsSync(shotDir(episodeId, shotId))) throw new Error(`Кадра ${shotId} нет`);
  const next: ShotSettings = { ...readShotSettings(episodeId, shotId) };
  if (on) next.strictFirstFrame = true;
  else delete next.strictFirstFrame;
  writeText(settingsPath(episodeId, shotId), `${JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  return next;
}
