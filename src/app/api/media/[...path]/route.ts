import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { resolveMediaPath } from "@/lib/series/media";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
};

/**
 * Файлы на чтение: `/api/media/episodes/<id>/...` и `/api/media/{characters,locations,references}/...`.
 * Путь собирает `listMediaFiles` (lib/series/media.ts).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  let absolute: string;
  try {
    absolute = resolveMediaPath((await context.params).path || []);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Некорректный путь";
    return NextResponse.json({ error: message }, { status: 403 });
  }
  try {
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    }
    const ext = path.extname(absolute).toLowerCase();
    const body = fs.readFileSync(absolute);
    return new NextResponse(body, {
      headers: {
        "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка файла";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
