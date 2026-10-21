import { NextResponse } from "next/server";
import { setEpisodeTitle } from "@/lib/series/episode-title";
import { normalizeEpisodeId } from "@/lib/series/paths";
import { scanSeries } from "@/lib/series/scanner";

export const runtime = "nodejs";

/** Сводка одного эпизода для таблицы. Открытый эпизод (`current_episode.txt`) не меняет. */
export async function GET(_request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const { episodeId } = await context.params;
    return NextResponse.json(scanSeries(normalizeEpisodeId(episodeId)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка чтения эпизода";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Переименовать эпизод: меняется заголовок episode.md, id папки остаётся. */
export async function PATCH(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const { episodeId } = await context.params;
    const body = (await request.json()) as { title?: unknown };
    if (typeof body.title !== "string") return NextResponse.json({ error: "Нужно title" }, { status: 400 });
    const title = setEpisodeTitle(normalizeEpisodeId(episodeId), body.title);
    return NextResponse.json({ episodeId, title });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось переименовать эпизод";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
