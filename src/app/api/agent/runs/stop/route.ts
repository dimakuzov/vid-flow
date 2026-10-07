import { NextResponse } from "next/server";
import { listAgentRuns, stopAgentRuns } from "@/lib/series/agent-dispatch";
import { parseStageParams } from "@/lib/series/route-params";

export const runtime = "nodejs";

/**
 * Остановка агентов доски, как «Отменить» на этапе.
 * Тело `{ episodeId, shotId, stageId }` — один прогон, `{ episodeId, format: true }` — разметка
 * сценария эпизода, `{ all: true }` — все работающие и ждущие.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      all?: unknown;
      format?: unknown;
      episodeId?: unknown;
      shotId?: unknown;
      stageId?: unknown;
    };
    let target: Parameters<typeof stopAgentRuns>[0];
    if (body.all === true) {
      target = "all";
    } else if (body.format === true) {
      if (typeof body.episodeId !== "string" || !body.episodeId) throw new Error("Нужен episodeId");
      target = { episodeId: body.episodeId, format: true };
    } else {
      if (typeof body.episodeId !== "string" || typeof body.shotId !== "string" || typeof body.stageId !== "string") {
        throw new Error("Нужно { episodeId, shotId, stageId }, { episodeId, format: true } или { all: true }");
      }
      target = parseStageParams({ episodeId: body.episodeId, shotId: body.shotId, stage: body.stageId });
    }
    const stopped = await stopAgentRuns(target);
    return NextResponse.json({ stopped, ...listAgentRuns() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось остановить";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
