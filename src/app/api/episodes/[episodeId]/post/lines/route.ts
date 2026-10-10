import { NextResponse } from "next/server";
import { normalizeEpisodeId } from "@/lib/series/paths";
import { updatePostLine, type LinePatch } from "@/lib/post/lines";
import { getPostState } from "@/lib/post/state";

export const runtime = "nodejs";

/**
 * Правка реплики: `{ id, at?, trimIn?, trimOut?, speed? }`. `at: null` / `speed: null` — вернуть авто.
 * Текст и персонаж правятся в speech.md кадра, не здесь. Ответ — состояние поста.
 */
export async function PATCH(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.id !== "string") throw new Error("Нет id реплики");
    const patch: LinePatch = {};
    if (body.at === null || typeof body.at === "number") patch.at = body.at;
    if (typeof body.trimIn === "number") patch.trimIn = body.trimIn;
    if (typeof body.trimOut === "number") patch.trimOut = body.trimOut;
    if (body.speed === null || typeof body.speed === "number") patch.speed = body.speed;
    await updatePostLine(episodeId, body.id, patch);
    return NextResponse.json(await getPostState(episodeId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить реплику";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
