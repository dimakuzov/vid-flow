import fs from "fs";
import path from "path";
import type { StageId } from "./constants";
import { readTextIfExists, writeText, mediaUrlPath } from "./media";
import { assertSafeSegment, ensureStageDirs, getLocationsRoot, isInside, shotDir, stageDir } from "./paths";
import { readShotMeta, writeShotMeta } from "./shot-meta";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export interface LibraryLocation {
  /** Имя папки в `data/locations/`. */
  id: string;
  /** Путь для `/api/media/<path>`; null — в папке нет картинки. */
  thumbnail: string | null;
}

/** Старые варианты базы: папки `_old`, `kitchen_old` и скрытые. */
function isSkippedFolder(name: string): boolean {
  return name.startsWith(".") || /(^|_)old$/i.test(name);
}

function images(folder: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return [];
  }
  return names
    .filter((name) => IMAGE_EXT.has(path.extname(name).toLowerCase()))
    .filter((name) => !/copy/i.test(name))
    .filter((name) => fs.statSync(path.join(folder, name)).isFile())
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Общий вид локации: `view.png`, иначе первая картинка без «copy» в имени. */
export function locationViewFile(folder: string): string | null {
  const files = images(folder);
  const view = files.find((name) => name.toLowerCase() === "view.png");
  const name = view ?? files[0];
  return name ? path.join(folder, name) : null;
}

/** Папки `data/locations/` по имени, с миниатюрой общего вида. */
export function listLibraryLocations(): LibraryLocation[] {
  const root = getLocationsRoot();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !isSkippedFolder(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((id) => {
      const view = locationViewFile(path.join(root, id));
      return { id, thumbnail: view ? mediaUrlPath(view) : null };
    });
}

/** Папка локации внутри `data/locations/`. Ошибка на чужой путь и на отсутствующую папку. */
function locationFolder(locationId: string): string {
  const id = assertSafeSegment(String(locationId ?? "").trim(), "id локации");
  const root = getLocationsRoot();
  const folder = path.join(root, id);
  if (!isInside(root, folder) || path.resolve(folder) === path.resolve(root)) {
    throw new Error("Некорректный id локации");
  }
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory() || isSkippedFolder(id)) {
    throw new Error(`Нет локации ${id} в data/locations/`);
  }
  return folder;
}

/**
 * Новая пустая папка `data/locations/{имя}`. Имя — латиница, цифры, _ и -.
 * Уже существующую папку не затирает.
 */
export function createLibraryLocation(raw: string): string {
  const name = raw.trim().replace(/\s+/g, "_");
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name) || isSkippedFolder(name)) {
    throw new Error("Имя локации — латиница, цифры, _ и -. Например kitchen");
  }
  const root = getLocationsRoot();
  fs.mkdirSync(root, { recursive: true });
  const existing = fs.readdirSync(root).find((item) => item.toLowerCase() === name.toLowerCase());
  if (existing) throw new Error(`Локация ${existing} уже есть`);
  fs.mkdirSync(path.join(root, name));
  return name;
}

/**
 * Поставить кадр на локацию из библиотеки. Меняет только строку `- location:` в shot.md.
 * Папка должна уже быть в `data/locations/`.
 */
export function assignShotLocation(episodeId: string, shotId: string, locationId: string): string {
  const folder = locationFolder(locationId);
  const id = path.basename(folder);
  setShotLocation(episodeId, shotId, id);
  return id;
}

/** Поменять `- location:` в shot.md, остальной текст файла не трогать. */
function setShotLocation(episodeId: string, shotId: string, locationId: string): void {
  const file = path.join(shotDir(episodeId, shotId), "shot.md");
  const content = readTextIfExists(file);
  const line = /^(-\s*(?:location|локация)\s*:).*$/im;
  if (line.test(content)) {
    writeText(file, content.replace(line, `$1 ${locationId}`));
    return;
  }
  writeShotMeta(episodeId, { ...readShotMeta(episodeId, shotId), location: locationId });
}

export interface CopyFromLibraryResult {
  /** Имя файла в refs/. */
  savedAs: string;
  /** Файл с таким именем уже был в refs/: не перезаписан. */
  existed: boolean;
  /** Локация записана в shot.md. */
  shotLocation?: string;
}

/**
 * Скопировать общий вид локации из библиотеки в `refs/` этапа как `{locationId}_view{ext}`.
 * Существующий файл не затирается. Новый файл помечает `agent_touch.json` (правка пользователя).
 */
export function copyLocationToRefs(options: {
  episodeId: string;
  shotId: string;
  stageId: StageId;
  locationId: string;
  writeToShot?: boolean;
}): CopyFromLibraryResult {
  const shotId = assertSafeSegment(options.shotId, "кадр");
  const folder = locationFolder(options.locationId);
  const locationId = path.basename(folder);
  const view = locationViewFile(folder);
  if (!view) throw new Error(`В data/locations/${locationId}/ нет картинки`);

  ensureStageDirs(options.episodeId, shotId);
  const stagePath = stageDir(options.episodeId, shotId, options.stageId);
  const refsDir = path.join(stagePath, "refs");
  const savedAs = `${locationId}_view${path.extname(view).toLowerCase()}`;
  const target = path.join(refsDir, savedAs);
  const existed = fs.existsSync(target);
  if (!existed) {
    fs.copyFileSync(view, target, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(
      path.join(stagePath, "agent_touch.json"),
      JSON.stringify({ refsTouchedByUser: true, touchedAt: new Date().toISOString() }, null, 2) + "\n",
    );
  }

  const result: CopyFromLibraryResult = { savedAs, existed };
  if (options.writeToShot) {
    setShotLocation(options.episodeId, shotId, locationId);
    result.shotLocation = locationId;
  }
  return result;
}
