import { NextResponse } from "next/server";
import { normalizeEpisodeId } from "@/lib/series/paths";
import { enqueueVoiceJob, runVoiceJob } from "@/lib/post/voice-job";

export const runtime = "nodejs";

/**
 * «Озвучить» (`kind: "voice"`) или «Очистить голос» (`kind: "isolate"`, Voice Isolator по текущей озвучке) —
 * платно. `{ characters: string[], allowPaid: true, kind? }`; без `allowPaid` — ошибка,
 * в ElevenLabs ничего не уходит. Задание выполняется в процессе доски, ответ сразу — `VoiceJob`.
 */
export async function POST(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    const body = (await request.json().catch(() => ({}))) as { characters?: unknown; allowPaid?: unknown; kind?: unknown };
    const characters = Array.isArray(body.characters)
      ? body.characters.filter((item): item is string => typeof item === "string")
      : [];
    const job = await enqueueVoiceJob(episodeId, {
      characters,
      allowPaid: body.allowPaid === true,
      kind: body.kind === "isolate" ? "isolate" : "voice",
    });
    void runVoiceJob(episodeId, job.id).catch((error) => console.error("[frameboard] озвучка:", error));
    return NextResponse.json(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось поставить озвучку";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
