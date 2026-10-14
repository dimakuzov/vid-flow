import { NextResponse } from "next/server";
import { normalizeEpisodeId } from "@/lib/series/paths";
import { enqueueSubtitlesJob, runSubtitlesJob } from "@/lib/post/subtitles";

export const runtime = "nodejs";

/**
 * «Добавить субтитры» — бесплатно (melt и локальный ComfyUI). Последний проект Kdenlive эпизода:
 * звук → Whisper → пословные субтитры со стилем data/subtitles/style.ass → в проект (копия до правки) → рендер.
 * Ответ сразу — `SubtitlesJob`; ход — в `GET .../post` (`subtitlesJob`).
 */
export async function POST(_request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    const job = enqueueSubtitlesJob(episodeId);
    void runSubtitlesJob(episodeId, job.id).catch((error) => console.error("[frameboard] субтитры:", error));
    return NextResponse.json(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось начать субтитры";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
