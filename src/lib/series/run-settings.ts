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

export function writeRunSettings(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  settings: RunSettings,
): RunSettings {
  const next: RunSettings = { ...settings, updatedAt: new Date().toISOString() };
  if (!next.workflow) delete next.workflow;
  const file = path.join(stageDir(episodeId, shotId, stageId), FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}
