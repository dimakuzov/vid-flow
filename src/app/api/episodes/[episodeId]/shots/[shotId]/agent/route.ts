import { NextResponse } from "next/server";
import { parseShotParams, type ShotRouteContext } from "@/lib/series/route-params";
import { readShotAgent, readShotAgentActivity, writeShotAgent } from "@/lib/series/shot-agent";

export const runtime = "nodejs";

/** Агент кадра (`shots/{shotId}/agent.json`) и что он сейчас делает. */
export async function GET(_request: Request, context: ShotRouteContext) {
  try {
    const { episodeId, shotId } = parseShotParams(await context.params);
    return NextResponse.json({
      agent: readShotAgent(episodeId, shotId),
      activity: readShotAgentActivity(episodeId, shotId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось прочитать агента кадра";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** «Сохранить» в меню агента кадра. Тело `{ provider, model? }`. */
export async function PUT(request: Request, context: ShotRouteContext) {
  try {
    const { episodeId, shotId } = parseShotParams(await context.params);
    const body = (await request.json().catch(() => ({}))) as { provider?: unknown; model?: unknown };
    if (typeof body.provider !== "string") throw new Error("Нужен provider");
    const agent = writeShotAgent(episodeId, shotId, {
      provider: body.provider,
      model: typeof body.model === "string" ? body.model : null,
    });
    return NextResponse.json({ agent, activity: readShotAgentActivity(episodeId, shotId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить агента кадра";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
