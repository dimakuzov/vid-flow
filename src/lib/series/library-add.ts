import fs from "fs";
import path from "path";
import { characterFolder } from "./character-base";
import type { StageId } from "./constants";
import { locationFolder } from "./library";
import { mediaUrlPath, resolveMediaPath } from "./media";
import { copyIntoCharacterApprove } from "./mutations";
import { assertSafeSegment, getDataRoot, isInside, stageDir } from "./paths";
import { readShotMeta } from "./shot-meta";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/** Картинка из `data/characters/{name}/styled/`: персонаж в своём наряде. */
export interface StyledFile {
  character: string;
  name: string;
  /** Путь для `/api/media/<path>`. */
  path: string;
  label: string;
}

function imageFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => IMAGE_EXT.has(path.extname(name).toLowerCase()))
      .filter((name) => fs.statSync(path.join(dir, name)).isFile())
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

/** Свободное имя в папке: существующий файл не затирается, к имени добавляется _2, _3… */
function freeName(dir: string, filename: string): string {
  const parsed = path.parse(filename);
  let candidate = filename;
  for (let i = 2; fs.existsSync(path.join(dir, candidate)); i += 1) candidate = `${parsed.name}_${i}${parsed.ext}`;
  return candidate;
}

/** Файл из output/ или approve/ этапа. Только картинка, только имя без пути. */
function stageImage(episodeId: string, shotId: string, stageId: StageId, folder: string, filename: string): string {
  if (folder !== "output" && folder !== "approve") throw new Error("Нужна папка output или approve");
  const name = assertSafeSegment(filename, "файл");
  if (!IMAGE_EXT.has(path.extname(name).toLowerCase())) throw new Error("В библиотеку берутся только картинки");
  const absolute = path.join(stageDir(episodeId, assertSafeSegment(shotId, "кадр"), stageId), folder, name);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Файл не найден: ${name}`);
  return absolute;
}

function copyInto(source: string, dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const savedAs = freeName(dir, path.basename(source));
  fs.copyFileSync(source, path.join(dir, savedAs), fs.constants.COPYFILE_EXCL);
  return savedAs;
}

/** Картинка этапа персонажей → `data/characters/{character}/styled/`. */
export function addImageToCharacterStyled(options: {
  episodeId: string;
  shotId: string;
  folder: string;
  filename: string;
  character: string;
}): { savedAs: string; character: string } {
  const source = stageImage(options.episodeId, options.shotId, "characters", options.folder, options.filename);
  const root = characterFolder(options.character.trim());
  if (!root) throw new Error(`Нет персонажа ${options.character} в data/characters/`);
  return { savedAs: copyInto(source, path.join(root, "styled")), character: path.basename(root) };
}

/** Картинка этапа локации → папка локации кадра в `data/locations/`. */
export function addImageToLocation(options: {
  episodeId: string;
  shotId: string;
  folder: string;
  filename: string;
}): { savedAs: string; location: string } {
  const location = readShotMeta(options.episodeId, options.shotId).location.trim();
  if (!location) throw new Error("У кадра не выбрана локация");
  const source = stageImage(options.episodeId, options.shotId, "location", options.folder, options.filename);
  const root = locationFolder(location);
  return { savedAs: copyInto(source, root), location: path.basename(root) };
}

/** Одетые картинки указанных персонажей из их подпапок `styled/`. */
export function listStyledImages(characters: string[]): StyledFile[] {
  const files: StyledFile[] = [];
  for (const name of characters) {
    const root = characterFolder(name);
    if (!root) continue;
    const dir = path.join(root, "styled");
    const character = path.basename(root);
    for (const file of imageFiles(dir)) {
      const relative = mediaUrlPath(path.join(dir, file));
      if (relative) files.push({ character, name: file, path: relative, label: `${character} · ${file}` });
    }
  }
  return files;
}

/** Выбранные картинки из `styled/` → approve/ персонажей кадра под именем `{персонаж}_{shotId}`. */
export function copyStyledToApprove(episodeId: string, shotId: string, paths: string[]): string[] {
  if (!paths.length) throw new Error("Не выбраны файлы");
  const root = path.resolve(getDataRoot(), "characters");
  const files = paths.map((item) => {
    const absolute = resolveMediaPath(item.split("/").filter(Boolean));
    const parts = path.relative(root, absolute).split(path.sep);
    if (
      !isInside(root, absolute) ||
      parts.length !== 3 ||
      parts[1] !== "styled" ||
      !IMAGE_EXT.has(path.extname(parts[2]).toLowerCase())
    ) {
      throw new Error("Можно взять только картинку из подпапки styled/ персонажа");
    }
    return { absolute, filename: `${parts[0]}_${parts[2]}` };
  });
  return copyIntoCharacterApprove({ episodeId, shotId, requireNameMatch: true, files });
}
