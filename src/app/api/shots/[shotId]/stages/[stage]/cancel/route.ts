import { NextResponse } from "next/server";
import { STAGES, type StageId } from "@/lib/series/constants";
import { cancelStage } from "@/lib/series/agent-dispatch";
import { assertSafeSegment } from "@/lib/series/paths";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ shotId: string; stage: string }> },
) {
  try {
    const { shotId, stage } = await context.params;
    assertSafeSegment(shotId, "shot");
    if (!STAGES.includes(stage as StageId)) {
      return NextResponse.json({ error: "Неизвестный этап" }, { status: 400 });
    }
    await cancelStage(shotId, stage as StageId);
    return NextResponse.json({
      message: "Операция отменена. Этап снова свободен.",
      stage: getStageDetail(shotId, stage as StageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отменить";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
