import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getSeriesRoot } from "@/lib/series/paths";

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

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const parts = (await context.params).path || [];
    if (parts.some((part) => part === ".." || part.includes("\0"))) {
      return NextResponse.json({ error: "Некорректный путь" }, { status: 400 });
    }

    const root = getSeriesRoot();
    const absolute = path.resolve(root, ...parts);
    if (!absolute.startsWith(path.resolve(root))) {
      return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
    }
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
