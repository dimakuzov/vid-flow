import fs from "fs";
import path from "path";
import { episodeRoot } from "./paths";

/*
 * Кадры, снятые с таблицы галкой импорта. Папка shots/{id}/ не трогается:
 * галка обратно возвращает тот же кадр со всеми файлами.
 */

function hiddenFile(episodeId: string): string {
  return path.join(episodeRoot(episodeId), "hidden_shots.json");
}

/** Id кадров, которые есть на диске, но не показываются в таблице. */
export function readHiddenShotIds(episodeId: string): string[] {
  try {
    const data = JSON.parse(fs.readFileSync(hiddenFile(episodeId), "utf8")) as { ids?: unknown };
    if (!Array.isArray(data.ids)) return [];
    return data.ids.filter((id): id is string => typeof id === "string" && /^s\d+$/i.test(id));
  } catch {
    return [];
  }
}

/** Скрыть кадр из таблицы или вернуть. Файлы кадра не удаляются и не переписываются. */
export function setShotHidden(episodeId: string, shotId: string, hidden: boolean): void {
  if (!/^s\d+$/i.test(shotId)) throw new Error("Некорректный кадр");
  const ids = readHiddenShotIds(episodeId).filter((id) => id.toLowerCase() !== shotId.toLowerCase());
  if (hidden) ids.push(shotId);
  ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const file = hiddenFile(episodeId);
  if (!ids.length) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ids }, null, 2) + "\n", "utf8");
}
