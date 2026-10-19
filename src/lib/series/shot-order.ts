import fs from "fs";
import path from "path";
import { ensureStageDirs, episodeRoot, listShotIds, shotDir } from "./paths";
import { writeShotMeta } from "./shot-meta";

/**
 * Свой порядок кадров. Папки `s02` не переименовываются: меняется только последовательность в таблице.
 */
export function writeShotOrder(episodeId: string, ids: string[]): void {
  const onDisk = listShotIds(episodeId);
  const known = new Map(onDisk.map((id) => [id.toLowerCase(), id]));
  const next: string[] = [];
  for (const id of ids) {
    const found = known.get(id.toLowerCase());
    if (!found || next.some((item) => item.toLowerCase() === found.toLowerCase())) continue;
    next.push(found);
  }
  for (const id of onDisk) {
    if (!next.some((item) => item.toLowerCase() === id.toLowerCase())) next.push(id);
  }
  const file = path.join(episodeRoot(episodeId), "shot_order.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ids: next }, null, 2) + "\n", "utf8");
}

/** Id, который вводит пользователь: начинается с s, дальше латиница, цифры, _ и -. Например s04. */
export function userShotId(raw: string): string {
  const id = raw.trim().replace(/\s+/g, "");
  if (!/^s/i.test(id)) throw new Error("Id кадра начинается с s. Например s04");
  const normalized = id.toLowerCase();
  if (!/^s[a-z0-9_-]+$/.test(normalized)) {
    throw new Error("Id кадра: s, затем латиница, цифры, _ и -. Например s04");
  }
  return normalized;
}

/**
 * Новый кадр в конце. Id задаёт пользователь (s04), имя — подпись в таблице.
 * Уже существующие кадры не сдвигаются.
 */
export function createUserShot(episodeId: string, shotId: string, title: string): string {
  const name = title.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Нужно имя кадра");
  const id = userShotId(shotId);
  if (fs.existsSync(shotDir(episodeId, id))) throw new Error("Такой кадр уже есть");
  const existing = listShotIds(episodeId);
  ensureStageDirs(episodeId, id);
  writeShotMeta(episodeId, { id, title: name, summary: "", characters: [], location: "" });
  writeShotOrder(episodeId, [...existing, id]);
  return id;
}
