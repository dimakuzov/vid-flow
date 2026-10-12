import fs from "fs";
import path from "path";
import { STAGE_LABELS, STAGES, type StageId } from "./constants";
import { mediaUrlPath, resolveMediaPath } from "./media";
import { copyFilesToRefs } from "./mutations";
import {
  assertSafeSegment,
  getCharactersRoot,
  getLocationsRoot,
  getReferencesRoot,
  isInside,
  listShotIds,
  stageDir,
} from "./paths";
import { readShotMeta } from "./shot-meta";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** Картинка, которую можно скопировать в refs/. `path` — от data/, для `/api/media`. */
export interface RefSourceFile {
  path: string;
  name: string;
  label: string;
}

export interface RefSourceGroup {
  id: string;
  title: string;
  files: RefSourceFile[];
}

/** Старые варианты базы: папки `_old`, `kitchen_old` и скрытые. */
function isSkippedFolder(name: string): boolean {
  return name.startsWith(".") || /(^|_)old$/i.test(name);
}

function listDirs(root: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !isSkippedFolder(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Картинки папки. «copy» в имени — запасная копия, в сетку не кладём. */
function imagesIn(folder: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return [];
  }
  return names
    .filter((name) => IMAGE_EXT.has(path.extname(name).toLowerCase()))
    .filter((name) => !/copy/i.test(name))
    .filter((name) => {
      try {
        return fs.statSync(path.join(folder, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function asSource(absolute: string, label: string): RefSourceFile | null {
  const relative = mediaUrlPath(absolute);
  if (!relative) return null;
  return { path: relative, name: path.basename(absolute), label };
}

function folderFiles(folder: string, label: string): RefSourceFile[] {
  return imagesIn(folder)
    .map((name) => asSource(path.join(folder, name), label))
    .filter((file): file is RefSourceFile => file !== null);
}

/** Все картинки внутри корня, без папок `_old`. */
function walkFiles(root: string, labelOf: (absolute: string) => string): RefSourceFile[] {
  const found: RefSourceFile[] = [];
  const walk = (folder: string) => {
    if (!isInside(root, folder)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!isSkippedFolder(entry.name)) walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      if (/copy/i.test(entry.name)) continue;
      const file = asSource(absolute, labelOf(absolute));
      if (file) found.push(file);
    }
  };
  walk(root);
  found.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  return found;
}

function stageImages(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  folders: Array<"approve" | "output">,
): RefSourceFile[] {
  const files: RefSourceFile[] = [];
  for (const folder of folders) {
    const dir = path.join(stageDir(episodeId, shotId, stageId), folder);
    for (const file of folderFiles(dir, `${STAGE_LABELS[stageId]} · ${folder}`)) {
      files.push(file);
    }
  }
  return files;
}

/**
 * Откуда можно взять референс на этот этап.
 * Персонажи кадра — первыми. Текущий этап кадра в список не входит:
 * его output и approve правятся здесь же, а не копируются в свои refs.
 */
export function listRefSources(episodeId: string, shotId: string, stageId: StageId): RefSourceGroup[] {
  const shot = assertSafeSegment(shotId, "кадр");
  const meta = readShotMeta(episodeId, shot);
  const groups: RefSourceGroup[] = [];

  const folders = listDirs(getCharactersRoot());
  const shotOrder = meta.characters
    .map((name) => folders.find((folder) => folder.toLowerCase() === name.toLowerCase()))
    .filter((folder): folder is string => Boolean(folder));
  const shotSet = new Set(shotOrder.map((folder) => folder.toLowerCase()));
  const shotFiles = shotOrder.flatMap((folder) =>
    folderFiles(path.join(getCharactersRoot(), folder), folder),
  );
  if (shotFiles.length) {
    groups.push({ id: "characters-shot", title: "Персонажи кадра", files: shotFiles });
  }
  const restFiles = folders
    .filter((folder) => !shotSet.has(folder.toLowerCase()))
    .flatMap((folder) => folderFiles(path.join(getCharactersRoot(), folder), folder));
  if (restFiles.length) {
    groups.push({ id: "characters-rest", title: "Остальные персонажи", files: restFiles });
  }

  const locations = listDirs(getLocationsRoot()).flatMap((id) =>
    folderFiles(path.join(getLocationsRoot(), id), id),
  );
  if (locations.length) groups.push({ id: "locations", title: "Локации", files: locations });

  const shared = walkFiles(getReferencesRoot(), (absolute) => path.basename(absolute));
  if (shared.length) groups.push({ id: "references", title: "Общие картинки", files: shared });

  for (const other of STAGES) {
    if (other === stageId) continue;
    const files = stageImages(episodeId, shot, other, ["approve", "output"]);
    if (files.length) {
      groups.push({ id: `stage-${other}`, title: `${STAGE_LABELS[other]} этого кадра`, files });
    }
  }

  const sameStage: RefSourceFile[] = [];
  for (const otherShot of listShotIds(episodeId)) {
    if (otherShot === shot) continue;
    for (const file of stageImages(episodeId, otherShot, stageId, ["approve"])) {
      sameStage.push({ ...file, label: `${otherShot} · ${file.name}` });
    }
  }
  if (sameStage.length) {
    groups.push({ id: "other-shots", title: "Тот же этап, другие кадры", files: sameStage });
  }

  return groups;
}

/**
 * Пути из списка источников → файлы для копирования.
 * Путь, которого нет в списке этого этапа, не берётся.
 */
export function resolveRefSources(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  paths: string[],
): { absolute: string; filename: string }[] {
  const allowed = new Map(
    listRefSources(episodeId, shotId, stageId).flatMap((group) => group.files.map((file) => [file.path, file])),
  );
  const unique = [...new Set(paths.map((item) => item.trim()).filter(Boolean))];
  if (!unique.length) throw new Error("Не выбраны файлы");
  return unique.map((relative) => {
    const found = allowed.get(relative);
    if (!found) throw new Error(`Этот файл нельзя взять в референсы: ${path.basename(relative)}`);
    return { absolute: resolveMediaPath(relative.split("/")), filename: found.name };
  });
}

/** Скопировать выбранные источники в refs/ этого этапа. */
export function copyRefSources(options: {
  episodeId: string;
  shotId: string;
  stageId: StageId;
  paths: string[];
}): string[] {
  const files = resolveRefSources(options.episodeId, options.shotId, options.stageId, options.paths);
  return copyFilesToRefs({
    episodeId: options.episodeId,
    shotId: options.shotId,
    stageId: options.stageId,
    files,
  });
}
