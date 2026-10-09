import { NextResponse } from "next/server";
import { normalizeEpisodeId } from "@/lib/series/paths";
import { getPostState } from "@/lib/post/state";

export const runtime = "nodejs";

/** Секция «Пост»: реплики, голоса, таймлайны, последнее задание озвучки (`docs/contracts/post.md`). */
export async function GET(_request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    return NextResponse.json(await getPostState(episodeId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось прочитать пост";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
