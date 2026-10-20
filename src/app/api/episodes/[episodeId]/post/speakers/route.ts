import { NextResponse } from "next/server";
import { normalizeEpisodeId } from "@/lib/series/paths";
import { assignSpeaker } from "@/lib/post/speakers";
import { getPostState } from "@/lib/post/state";

export const runtime = "nodejs";

/**
 * Кто озвучивает имя из сценария: `{ speaker, character | null, remember? }`.
 * `character` — папка data/characters (null — снять назначение эпизода); `remember` — псевдоним для всех эпизодов.
 * Ответ — состояние поста.
 */
export async function PUT(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    const body = (await request.json().catch(() => ({}))) as { speaker?: unknown; character?: unknown; remember?: unknown };
    if (typeof body.speaker !== "string") throw new Error("Нет имени из сценария");
    const character = typeof body.character === "string" && body.character.trim() ? body.character : null;
    assignSpeaker(episodeId, body.speaker, character, body.remember === true);
    return NextResponse.json(await getPostState(episodeId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось назначить голос";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
