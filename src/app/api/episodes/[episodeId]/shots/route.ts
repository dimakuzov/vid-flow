import { NextResponse } from "next/server";
import { normalizeEpisodeId } from "@/lib/series/paths";
import { createUserShot } from "@/lib/series/shot-order";

export const runtime = "nodejs";

/** Новый кадр в конце: id как s04 и имя в таблице. */
export async function POST(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    const body = (await request.json()) as { id?: unknown; title?: unknown };
    if (typeof body.id !== "string" || typeof body.title !== "string") {
      return NextResponse.json({ error: "Нужны id и имя" }, { status: 400 });
    }
    const shotId = createUserShot(episodeId, body.id, body.title);
    return NextResponse.json({ shotId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось добавить кадр";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
