import fs from "fs";
import path from "path";
import { episodeRoot, getCharactersRoot, isInside } from "../series/paths";

/*
 * Папка поста эпизода: `data/episodes/{ep}/post/` (контракт — docs/contracts/post.md).
 *   lines.json                    таблица реплик
 *   voices/{character}/v{N}.wav   озвучка персонажа версиями, рядом v{N}.json и куски v{N}.part{K}.mp3/.json
 *   voices/{character}/current.json  какая версия в работе
 *   manifest.json                 манифест последней сборки таймлайна
 *   timeline/{ep}_v{N}.fcpxml     таймлайны для Resolve, старые не затираются
 *   jobs/{id}.json                задания озвучки
 */

/** Таймлайн всегда 24 fps — формат проекта. */
export const TIMELINE_FPS = 24;

export function postDir(episodeId: string): string {
  return path.join(episodeRoot(episodeId), "post");
}

export function linesFile(episodeId: string): string {
  return path.join(postDir(episodeId), "lines.json");
}

export function manifestFile(episodeId: string): string {
  return path.join(postDir(episodeId), "manifest.json");
}

export function timelineDir(episodeId: string): string {
  return path.join(postDir(episodeId), "timeline");
}

export function jobsDir(episodeId: string): string {
  return path.join(postDir(episodeId), "jobs");
}

/** Имя папки озвучки персонажа: латиница, цифры, `_`, `-` (из имени в speech.md). */
export function characterKey(name: string): string {
  const key = name.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_-]/g, "");
  if (!key) throw new Error(`Имя персонажа «${name}» не подходит для папки: нужна латиница`);
  return key;
}

export function voicesDir(episodeId: string, character: string): string {
  return path.join(postDir(episodeId), "voices", characterKey(character));
}

/** Папка персонажа в библиотеке `data/characters/` без учёта регистра; null — нет такой. */
export function libraryCharacterDir(name: string): string | null {
  const root = getCharactersRoot();
  let folder: string | undefined;
  try {
    folder = fs
      .readdirSync(root, { withFileTypes: true })
      .find((entry) => entry.isDirectory() && entry.name.toLowerCase() === name.trim().toLowerCase())?.name;
  } catch {
    return null;
  }
  return folder ? path.join(root, folder) : null;
}

/** Имя персонажа как папка библиотеки (`julia` → `Julia`), иначе как в speech.md. */
export function canonicalCharacter(name: string): string {
  const dir = name.trim() ? libraryCharacterDir(name) : null;
  return dir ? path.basename(dir) : name.trim();
}

/** Файл внутри папки поста по пути от неё (`timeline/ep2_v1.fcpxml`); бросает ошибку на выход за папку. */
export function resolvePostFile(episodeId: string, relative: string): string {
  const root = postDir(episodeId);
  if (!relative || relative.includes("\0")) throw new Error("Некорректный путь");
  const absolute = path.resolve(root, relative);
  if (!isInside(root, absolute) || absolute === path.resolve(root)) throw new Error("Доступ запрещён");
  return absolute;
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Запись через временный файл: доска не прочитает наполовину записанный JSON. */
export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}
