import fs from "fs";
import path from "path";
import type { StageId } from "./constants";
import { mediaUrlPath, resolveMediaPath } from "./media";
import { isInside, listShotIds, stageDir } from "./paths";
import { normalizeCharacterName, readShotMeta } from "./shot-meta";

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
  /**
   * Картинка, которую пользователь сам поставил персонажем в граф (image 1).
   * Ключ — имя строчными, значение — путь как MediaFile.relativePath
   * (output или refs этого кадра, либо персонажи предыдущего кадра).
   */
  characterImage?: Record<string, string>;
  /** Первый кадр: дальность до камеры по персонажу (ключ — имя строчными). См. first-frame-settings.ts. */
  framing?: Record<string, string>;
  /** Первый кадр: что это за файл refs/, со слов пользователя (ключ — имя файла). */
  refNotes?: Record<string, string>;
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
  if (!next.characterImage || !Object.keys(next.characterImage).length) delete next.characterImage;
  if (!next.framing || !Object.keys(next.framing).length) delete next.framing;
  if (!next.refNotes || !Object.keys(next.refNotes).length) delete next.refNotes;
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

const CHARACTER_IMAGE = /\.(png|jpe?g|webp)$/i;

/** Папки, откуда персонажа можно поставить в граф: output и refs этого кадра, персонажи предыдущего. */
function characterImageDirs(episodeId: string, shotId: string): string[] {
  const here = stageDir(episodeId, shotId, "characters");
  const dirs = [path.join(here, "refs"), path.join(here, "output")];
  const ids = listShotIds(episodeId);
  const index = ids.findIndex((id) => id.toLowerCase() === shotId.toLowerCase());
  if (index > 0) {
    const previous = stageDir(episodeId, ids[index - 1], "characters");
    dirs.push(path.join(previous, "approve"), path.join(previous, "output"));
  }
  return dirs;
}

/**
 * Файл, который пользователь выбрал персонажем (image 1). Нет выбора или файла — null,
 * тогда граф берёт `{имя}_base` или библиотеку.
 */
export function chosenCharacterFile(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  character: string,
): string | null {
  const rel = readRunSettings(episodeId, shotId, stageId).characterImage?.[character.toLowerCase()];
  if (!rel) return null;
  let absolute: string;
  try {
    absolute = resolveMediaPath(rel.split("/"));
  } catch {
    return null;
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || !CHARACTER_IMAGE.test(absolute)) return null;
  return absolute;
}

/**
 * Поставить картинку персонажем в графе или сбросить выбор (`null`).
 * Файл не копируется и не удаляется. Снятая раньше пометка «убрать из графа» снимается.
 */
export function setCharacterImage(
  episodeId: string,
  shotId: string,
  name: string,
  mediaPath: string | null,
): RunSettings {
  const character = normalizeCharacterName(name);
  const known = readShotMeta(episodeId, shotId).characters.some((item) => item.toLowerCase() === character);
  if (!known) throw new Error(`${character} нет в этом кадре`);
  const settings = readRunSettings(episodeId, shotId, "characters");
  const map = { ...(settings.characterImage ?? {}) };
  if (!mediaPath) {
    delete map[character];
  } else {
    const absolute = resolveMediaPath(mediaPath.trim().replace(/\\/g, "/").split("/"));
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || !CHARACTER_IMAGE.test(absolute)) {
      throw new Error("Нужна картинка");
    }
    const allowed = characterImageDirs(episodeId, shotId).some((dir) => isInside(dir, absolute));
    if (!allowed) throw new Error("Персонажа можно взять из output, refs или предыдущего кадра");
    const relative = mediaUrlPath(absolute);
    if (!relative) throw new Error("Некорректный путь файла");
    map[character] = relative;
    if (settings.excluded?.includes(relative)) {
      settings.excluded = settings.excluded.filter((item) => item !== relative);
    }
  }
  settings.characterImage = map;
  return writeRunSettings(episodeId, shotId, "characters", settings);
}
