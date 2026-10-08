import fs from "fs";
import path from "path";
import type { StageId } from "./constants";
import { stageDir } from "./paths";

/**
 * `run_settings.json` папки этапа: выбор пользователя для прогона. Пишет только доска (PATCH этапа).
 * Нет файла или поля — вариант по умолчанию.
 */
export interface RunSettings {
  /** id манифеста графа (docs/contracts/graph-binding.md). */
  workflow?: string;
  /** Длительность клипа в секундах (вход settings:seconds манифеста). Нет — по умолчанию. */
  durationSec?: number;
  /**
   * Файлы, которые пользователь убрал из графа этого этапа, не удаляя с диска: пути как
   * `MediaFile.relativePath` (от data/: `episodes/ep2/shots/s01/first_frame/refs/x.png`,
   * `characters/Lena/portret.png`). Граф их пропускает, агент видит пометку.
   */
  excluded?: string[];
  updatedAt?: string;
}

const FILE = "run_settings.json";

export function readRunSettings(episodeId: string, shotId: string, stageId: StageId): RunSettings {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(stageDir(episodeId, shotId, stageId), FILE), "utf8"));
    return data && typeof data === "object" ? (data as RunSettings) : {};
  } catch {
    return {};
  }
}

/** Пишет файл целиком. Пустые поля (`workflow: ""`, `durationSec` не число) удаляются. */
export function writeRunSettings(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  settings: RunSettings,
): RunSettings {
  const next: RunSettings = { ...settings, updatedAt: new Date().toISOString() };
  if (!next.workflow) delete next.workflow;
  if (typeof next.durationSec !== "number" || !Number.isFinite(next.durationSec)) delete next.durationSec;
  if (!Array.isArray(next.excluded) || !next.excluded.length) delete next.excluded;
  const file = path.join(stageDir(episodeId, shotId, stageId), FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

/** Меняет только переданные поля, остальной выбор сохраняется. `null` — сбросить поле. */
export function updateRunSettings(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  patch: { workflow?: string | null; durationSec?: number | null },
): RunSettings {
  const next: RunSettings = { ...readRunSettings(episodeId, shotId, stageId) };
  if (patch.workflow !== undefined) next.workflow = patch.workflow ?? undefined;
  if (patch.durationSec !== undefined) next.durationSec = patch.durationSec ?? undefined;
  return writeRunSettings(episodeId, shotId, stageId, next);
}

/** Убранные из графа файлы этапа (пути от data/). */
export function excludedFiles(episodeId: string, shotId: string, stageId: StageId): Set<string> {
  const list = readRunSettings(episodeId, shotId, stageId).excluded;
  return new Set(Array.isArray(list) ? list.filter((item) => typeof item === "string") : []);
}

/** Убрать файл из графа этапа или вернуть его. Файл на диске не трогается. */
export function setExcluded(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  mediaPath: string,
  excluded: boolean,
): RunSettings {
  const clean = mediaPath.trim().replace(/\\/g, "/");
  if (!clean || clean.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Некорректный путь файла");
  }
  const set = excludedFiles(episodeId, shotId, stageId);
  if (excluded) set.add(clean);
  else set.delete(clean);
  const next: RunSettings = { ...readRunSettings(episodeId, shotId, stageId), excluded: [...set].sort() };
  return writeRunSettings(episodeId, shotId, stageId, next);
}
