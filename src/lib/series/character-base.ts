import fs from "fs";
import path from "path";
import type { StageId } from "./constants";
import { listMediaFiles, mediaUrlPath } from "./media";
import { getCharactersRoot, listShotIds, stageDir } from "./paths";
import { chosenCharacterFile, excludedFiles } from "./run-settings";
import { readShotMeta } from "./shot-meta";

/**
 * База персонажа в data/characters/{name}/. Одна функция на страницу этапа и на граф,
 * чтобы полный рост не выбирался в двух местах по-разному.
 */

const IMAGE = /\.(png|jpe?g|webp)$/i;
/** Каноническое имя и старые имена из исходных заметок. */
const NAMED_SLOTS = [
  ["full_body.png", "body.png"],
  ["portrait.png", "portret.png"],
  ["side.png", "portret_side.png"],
];

/** Папка data/characters/{name}/ без учёта регистра. Нет папки — null. */
export function characterFolder(name: string): string | null {
  if (!name) return null;
  const root = getCharactersRoot();
  try {
    const found = fs.readdirSync(root).find((item) => item.toLowerCase() === name.toLowerCase());
    return found ? path.join(root, found) : null;
  } catch {
    return null;
  }
}

function imagesIn(folder: string): string[] {
  try {
    return fs
      .readdirSync(folder)
      .filter((name) => IMAGE.test(name) && !/copy/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name) => path.join(folder, name))
      .filter((file) => fs.statSync(file).isFile());
  } catch {
    return [];
  }
}

/** Картинки папки для показа: канонические слоты, иначе любые без «copy» в имени. */
export function characterBaseFiles(folder: string): string[] {
  const named = NAMED_SLOTS.map((names) => names.map((name) => path.join(folder, name)).find((file) => fs.existsSync(file)))
    .filter((file): file is string => Boolean(file));
  if (named.length) return named;
  return imagesIn(folder);
}

/**
 * Картинка, которая уйдёт в граф как image 1: full_body.png, иначе body.png,
 * иначе первая картинка без «copy». Лист из нескольких панелей не режется.
 */
export function characterBaseImage(folder: string): string | null {
  for (const name of ["full_body.png", "body.png"]) {
    const file = path.join(folder, name);
    if (fs.existsSync(file)) return file;
  }
  return imagesIn(folder)[0] ?? null;
}

/** Папки `data/characters/`, как они лежат на диске. Старые `_old` и скрытые не предлагаются. */
export function listLibraryCharacterNames(): string[] {
  const root = getCharactersRoot();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !/(^|_)old$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Предыдущий кадр эпизода по номеру (`s02` → `s01`). Первого кадра нет — null. */
export function previousShotId(episodeId: string, shotId: string): string | null {
  const ids = listShotIds(episodeId);
  const index = ids.findIndex((id) => id.toLowerCase() === shotId.toLowerCase());
  return index > 0 ? ids[index - 1] : null;
}

/** Картинки этапа персонажей предыдущего кадра: сначала approve, потом output. */
export function previousCharacterImages(
  episodeId: string,
  shotId: string,
): { id: string; files: ReturnType<typeof listMediaFiles> } | null {
  const id = previousShotId(episodeId, shotId);
  if (!id) return null;
  const dir = stageDir(episodeId, id, "characters");
  const files = [...listMediaFiles(path.join(dir, "approve")), ...listMediaFiles(path.join(dir, "output"))].filter(
    (file) => file.kind === "image",
  );
  return { id, files };
}

/**
 * Референсы одежды персонажа в refs/. Картинка самого персонажа сюда не входит:
 * ни `{имя}_base*`, ни файл, который пользователь поставил персонажем.
 * Файл без чужого имени тоже считается одеждой. Убранные из графа не считаются.
 */
export function characterClothingFiles(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  character: string,
): string[] {
  const id = character.toLowerCase();
  const people = readShotMeta(episodeId, shotId).characters.map((name) => name.toLowerCase());
  const chosen = chosenCharacterFile(episodeId, shotId, stageId, character);
  const excluded = excludedFiles(episodeId, shotId, stageId);
  const refs = path.join(stageDir(episodeId, shotId, stageId), "refs");
  let names: string[];
  try {
    names = fs.readdirSync(refs);
  } catch {
    return [];
  }
  const ownedBy = (stem: string, who: string) => stem === who || stem.startsWith(`${who}_`) || stem.startsWith(`${who}-`);
  return names
    .filter((name) => IMAGE.test(name))
    .map((name) => path.join(refs, name))
    .filter((file) => fs.statSync(file).isFile())
    .filter((file) => {
      const relative = mediaUrlPath(file);
      if (relative && excluded.has(relative)) return false;
      if (chosen && path.resolve(file) === path.resolve(chosen)) return false;
      const stem = path.parse(file).name.toLowerCase();
      if (stem === `${id}_base` || stem.startsWith(`${id}_base`)) return false;
      if (ownedBy(stem, id)) return true;
      return !people.some((who) => who !== id && ownedBy(stem, who));
    })
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
}

/** Больше одного референса одежды в один граф не берём. */
export function tooManyClothingRefs(name: string, count: number): string {
  return `В этот граф идёт один персонаж и не больше одного референса одежды. У ${name} референсов ${count}. Лишний уберите кнопкой «Убрать».`;
}

/** Текст ошибки, когда персонажа не из чего собрать. */
export function missingCharacterBase(name: string): string {
  return `нет базы для ${name}: положите картинку в data/characters/${name}/`;
}

/** Нет референса одежды: прогон идёт, нода «image 2: образец одежды» в bypass. */
export function missingCharacterClothes(name: string): string {
  return `нет референса одежды для ${name}: нода «image 2: образец одежды» в bypass`;
}
