import { NextResponse } from "next/server";
import { ensureEpisode, resolveEpisodeRoot } from "@/lib/series/paths";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { episodeId?: string };
    const episodeId = ensureEpisode(body.episodeId || "");
    return NextResponse.json({ episodeId, root: resolveEpisodeRoot(episodeId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось открыть эпизод";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
