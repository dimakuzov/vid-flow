import { NextResponse } from "next/server";
import { normalizeEpisodeId } from "@/lib/series/paths";
import { buildProject } from "@/lib/post/build";

export const runtime = "nodejs";

/**
 * «Собрать проект» — локально, бесплатно. Сначала распознаёт речь в финалах, где её ещё нет
 * (Whisper, очередь ComfyUI), и ждёт его; потом собирает `.kdenlive` и `.fcpxml`.
 * `{ width?, height? }`. Ответ — манифест новой версии.
 */
export async function POST(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    const body = (await request.json().catch(() => ({}))) as { width?: unknown; height?: unknown };
    const manifest = await buildProject(episodeId, {
      width: typeof body.width === "number" ? body.width : undefined,
      height: typeof body.height === "number" ? body.height : undefined,
    });
    return NextResponse.json(manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось собрать таймлайн";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
