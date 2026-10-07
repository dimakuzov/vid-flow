import { NextResponse } from "next/server";
import { listAgentRuns, stopAgentRuns } from "@/lib/series/agent-dispatch";
import { parseShotParams, parseStageParams } from "@/lib/series/route-params";

export const runtime = "nodejs";

/**
 * Остановка агентов доски, как «Отменить» на этапе.
 * Тело `{ episodeId, shotId, stageId }` — один прогон, `{ episodeId, shotId }` — все этапы кадра
 * («Остановить» в меню агента кадра), `{ episodeId, format: true }` — разметка
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
      if (typeof body.episodeId !== "string" || typeof body.shotId !== "string") {
        throw new Error("Нужно { episodeId, shotId, stageId? }, { episodeId, format: true } или { all: true }");
      }
      target =
        body.stageId === undefined
          ? parseShotParams({ episodeId: body.episodeId, shotId: body.shotId })
          : parseStageParams({ episodeId: body.episodeId, shotId: body.shotId, stage: String(body.stageId) });
    }
    const stopped = await stopAgentRuns(target);
    return NextResponse.json({ stopped, ...listAgentRuns() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось остановить";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
