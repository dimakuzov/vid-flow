import { NextResponse } from "next/server";
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
