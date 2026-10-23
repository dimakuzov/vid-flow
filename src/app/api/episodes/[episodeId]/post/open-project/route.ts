import { NextResponse } from "next/server";
import { normalizeEpisodeId } from "@/lib/series/paths";
import { openInKdenlive } from "@/lib/post/kdenlive-app";
import { latestProject } from "@/lib/post/subtitles";

export const runtime = "nodejs";

/** «Открыть в Kdenlive»: последний проект эпизода (`post/timeline/{ep}_vN.kdenlive`). Ответ `{ project }`. */
export async function POST(_request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    const project = latestProject(episodeId);
    if (!project) throw new Error("Нет проекта Kdenlive — сначала «Собрать проект»");
    openInKdenlive(episodeId, project);
    return NextResponse.json({ project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось открыть Kdenlive";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
