import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { normalizeEpisodeId } from "@/lib/series/paths";
import { resolvePostFile } from "@/lib/post/paths";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
  ".fcpxml": "application/xml",
  ".srt": "text/plain; charset=utf-8",
};

/**
 * Файл папки поста на чтение: `?path=voices/Lena/v1.wav`, `?path=timeline/ep2_v1.fcpxml`.
 * Звук — с поддержкой Range (перемотка в плеере). Таймлайн отдаётся на скачивание.
 */
export async function GET(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  let absolute: string;
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    absolute = resolvePostFile(episodeId, new URL(request.url).searchParams.get("path") || "");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Некорректный путь";
    return NextResponse.json({ error: message }, { status: 403 });
  }
  const ext = path.extname(absolute).toLowerCase();
  if (!CONTENT_TYPES[ext]) return NextResponse.json({ error: "Этот файл не отдаётся" }, { status: 403 });
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  }
  const body = fs.readFileSync(absolute);
  const headers: Record<string, string> = {
    "Content-Type": CONTENT_TYPES[ext],
    "Cache-Control": "no-store",
    "Accept-Ranges": "bytes",
  };
  if (ext === ".fcpxml") headers["Content-Disposition"] = `attachment; filename="${path.basename(absolute)}"`;
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const size = body.length;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    return new NextResponse(new Uint8Array(body.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new NextResponse(new Uint8Array(body), { headers: { ...headers, "Content-Length": String(body.length) } });
}
