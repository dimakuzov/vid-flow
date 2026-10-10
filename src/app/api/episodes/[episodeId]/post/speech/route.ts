import { NextResponse } from "next/server";
import { normalizeEpisodeId } from "@/lib/series/paths";
import { enqueueSpeechDetect } from "@/lib/post/speech-detect";

export const runtime = "nodejs";

/**
 * «Распознать речь» — Whisper по финалам кадров со своим звуком, через очередь локального ComfyUI
 * (бесплатно). `{ shotIds?, force? }`: без `force` уже распознанные и идущие кадры пропускаются.
 * Ответ `{ queued: [], skipped: [{ shotId, reason }] }`.
 */
export async function POST(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    const body = (await request.json().catch(() => ({}))) as { shotIds?: unknown; force?: unknown };
    const shotIds = Array.isArray(body.shotIds) ? body.shotIds.filter((item): item is string => typeof item === "string") : undefined;
    return NextResponse.json(await enqueueSpeechDetect(episodeId, { shotIds, force: body.force === true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось поставить распознавание";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
