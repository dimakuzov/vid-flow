import { NextResponse } from "next/server";
import { parseShotParams, type ShotRouteContext } from "@/lib/series/route-params";
import { setShotWatchStopped } from "@/lib/series/shot-watch";

export const runtime = "nodejs";

export async function POST(request: Request, context: ShotRouteContext) {
  try {
    const { episodeId, shotId } = parseShotParams(await context.params);
    const body = (await request.json()) as { stopped?: boolean };
    const watch = setShotWatchStopped(episodeId, shotId, body.stopped !== false);
    return NextResponse.json(watch);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось закрыть кадр";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
