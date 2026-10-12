import fs from "fs";
import path from "path";
import { getCharactersRoot } from "./paths";

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

/** Текст ошибки, когда персонажа не из чего собрать. */
export function missingCharacterBase(name: string): string {
  return `нет базы для ${name}: положите картинку в data/characters/${name}/`;
}

/** Нет образца: прогон идёт, нода «image 2: образец одежды» в bypass. */
export function missingCharacterClothes(name: string): string {
  const file = `${name.toLowerCase()}_clothes.png`;
  return `нет образца одежды для ${name} (${file}): нода «image 2: образец одежды» в bypass`;
}
