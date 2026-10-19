import { NextResponse } from "next/server";
import { normalizeEpisodeId } from "@/lib/series/paths";
import { writeShotOrder } from "@/lib/series/shot-order";

export const runtime = "nodejs";

/** Новый порядок кадров. Папки s01, s02 не переименовываются. */
export async function POST(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    const body = (await request.json()) as { ids?: unknown };
    if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "Нужен список кадров" }, { status: 400 });
    }
    writeShotOrder(episodeId, body.ids);
    return NextResponse.json({ ids: body.ids });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось поменять порядок";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
