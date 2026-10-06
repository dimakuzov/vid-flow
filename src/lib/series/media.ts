import fs from "fs";
import path from "path";
import { MEDIA_EXTENSIONS } from "./constants";
import {
  episodeRoot,
  getDataRoot,
  isInside,
  normalizeEpisodeId,
  toPosix,
} from "./paths";
import type { MediaFile, MediaKind } from "./types";

/** Папки `data/`, которые `/api/media` отдаёт на чтение. */
const LIBRARY_DIRS = new Set(["characters", "locations", "references"]);

export function mediaKind(filename: string): MediaKind {
  const ext = path.extname(filename).toLowerCase();
  if ([".mp4", ".webm", ".mov", ".mkv"].includes(ext)) return "video";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return "image";
  return "other";
}

/**
 * Путь файла в URL `/api/media/<path>`: `episodes/<id>/...` или `characters|locations|references/...`.
 * null — файл вне разрешённых папок.
 */
export function mediaUrlPath(absolute: string): string | null {
  const dataRoot = getDataRoot();
  if (process.env.SERIES_ROOT && isInside(process.env.SERIES_ROOT, absolute)) {
    const id = path.basename(path.resolve(process.env.SERIES_ROOT));
    const rest = toPosix(path.relative(path.resolve(process.env.SERIES_ROOT), absolute));
    return `episodes/${id}/${rest}`;
  }
  if (!isInside(dataRoot, absolute)) return null;
  const relative = toPosix(path.relative(dataRoot, absolute));
  const top = relative.split("/")[0];
  if (top !== "episodes" && !LIBRARY_DIRS.has(top)) return null;
  return relative;
}

/**
 * Обратное к mediaUrlPath: части URL → абсолютный путь внутри разрешённой папки.
 * Бросает ошибку на `..`, чужую папку или выход за корень.
 */
export function resolveMediaPath(parts: string[]): string {
  if (!parts.length || parts.some((part) => !part || part === ".." || part === "." || part.includes("\0"))) {
    throw new Error("Некорректный путь");
  }
  const [top, ...rest] = parts;
  let root: string;
  let tail: string[];
  if (top === "episodes") {
    const [episodeId, ...inside] = rest;
    root = episodeRoot(normalizeEpisodeId(episodeId || ""));
    tail = inside;
  } else if (LIBRARY_DIRS.has(top)) {
    root = path.join(getDataRoot(), top);
    tail = rest;
  } else {
    throw new Error("Доступ запрещён");
  }
  if (!tail.length) throw new Error("Некорректный путь");
  const absolute = path.resolve(root, ...tail);
  if (!isInside(root, absolute) || absolute === path.resolve(root)) throw new Error("Доступ запрещён");
  return absolute;
}

export function listMediaFiles(absoluteDir: string): MediaFile[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: MediaFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const absolute = path.join(absoluteDir, entry.name);
    const relativePath = mediaUrlPath(absolute);
    if (!relativePath) continue;
    let version = 0;
    try {
      version = Math.floor(fs.statSync(absolute).mtimeMs);
    } catch {
      continue;
    }
    files.push({
      name: entry.name,
      relativePath,
      kind: mediaKind(entry.name),
      url: `/api/media/${relativePath.split("/").map(encodeURIComponent).join("/")}?v=${version}`,
    });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export function readTextIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

export function writeText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}
