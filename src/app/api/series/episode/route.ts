import { NextResponse } from "next/server";
import { createEpisode, episodeRoot, writeCurrentEpisodeId } from "@/lib/series/paths";

export const runtime = "nodejs";

/** Создаёт эпизод, если его нет, и делает его открытым по умолчанию (`current_episode.txt`). */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { episodeId?: string };
    const episodeId = createEpisode(body.episodeId || "");
    writeCurrentEpisodeId(episodeId);
    return NextResponse.json({ episodeId, root: episodeRoot(episodeId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось открыть эпизод";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
