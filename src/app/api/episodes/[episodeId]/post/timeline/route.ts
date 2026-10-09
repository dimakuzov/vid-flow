import { NextResponse } from "next/server";
import { normalizeEpisodeId } from "@/lib/series/paths";
import { buildTimeline } from "@/lib/post/timeline";

export const runtime = "nodejs";

/** «Собрать таймлайн» — локально, бесплатно. `{ width?, height? }`. Ответ — манифест новой версии. */
export async function POST(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    const body = (await request.json().catch(() => ({}))) as { width?: unknown; height?: unknown };
    const manifest = await buildTimeline(episodeId, {
      width: typeof body.width === "number" ? body.width : undefined,
      height: typeof body.height === "number" ? body.height : undefined,
    });
    return NextResponse.json(manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось собрать таймлайн";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
