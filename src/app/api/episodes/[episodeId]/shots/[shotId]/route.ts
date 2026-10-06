import { NextResponse } from "next/server";
import { rebuildAgentInbox } from "@/lib/series/agent-request";
import { deleteShot } from "@/lib/series/mutations";
import { parseShotParams, type ShotRouteContext } from "@/lib/series/route-params";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: ShotRouteContext) {
  try {
    const { episodeId, shotId } = parseShotParams(await context.params);
    deleteShot(episodeId, shotId);
    rebuildAgentInbox(episodeId);
    return NextResponse.json({ deleted: shotId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось убрать кадр";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
