import { NextResponse } from "next/server";
import { queueStageRun } from "@/lib/comfy/stage-run";
import { STAGES, type StageId } from "@/lib/series/constants";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ shotId: string; stage: string }> },
) {
  try {
    const { shotId, stage } = await context.params;
    if (!STAGES.includes(stage as StageId)) {
      return NextResponse.json({ error: "Неизвестный этап" }, { status: 400 });
    }

    const queued = queueStageRun(shotId, stage as StageId);
    return NextResponse.json({
      message: queued.message,
      jobId: queued.id,
      stage: getStageDetail(shotId, stage as StageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка запуска";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
