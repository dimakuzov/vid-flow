import { NextResponse } from "next/server";
import { rebuildAgentInbox } from "@/lib/series/agent-request";
import { deleteShot } from "@/lib/series/mutations";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ shotId: string }> },
) {
  try {
    const { shotId } = await context.params;
    deleteShot(shotId);
    rebuildAgentInbox();
    return NextResponse.json({ deleted: shotId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось убрать кадр";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
