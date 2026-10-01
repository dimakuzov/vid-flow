import fs from "fs";
import path from "path";
import { MEDIA_EXTENSIONS } from "./constants";
import { getSeriesRoot, toPosix } from "./paths";
import type { MediaFile, MediaKind } from "./types";

export function mediaKind(filename: string): MediaKind {
  const ext = path.extname(filename).toLowerCase();
  if ([".mp4", ".webm", ".mov", ".mkv"].includes(ext)) return "video";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return "image";
  return "other";
}

export function listMediaFiles(absoluteDir: string): MediaFile[] {
  if (!fs.existsSync(absoluteDir)) return [];
  const seriesRoot = getSeriesRoot();
  return fs
    .readdirSync(absoluteDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => {
      const absolute = path.join(absoluteDir, entry.name);
      const relativePath = toPosix(path.relative(seriesRoot, absolute));
      const version = Math.floor(fs.statSync(absolute).mtimeMs);
      return {
        name: entry.name,
        relativePath,
        kind: mediaKind(entry.name),
        url: `/api/media/${relativePath}?v=${version}`,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readTextIfExists(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

export function writeText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}
