import { NextResponse } from "next/server";
import { assertSafeSegment } from "@/lib/series/paths";
import { setShotWatchStopped } from "@/lib/series/shot-watch";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ shotId: string }> },
) {
  try {
    const { shotId } = await context.params;
    assertSafeSegment(shotId, "shot");
    const body = (await request.json()) as { stopped?: boolean };
    const watch = setShotWatchStopped(shotId, body.stopped !== false);
    return NextResponse.json(watch);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось закрыть кадр";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
