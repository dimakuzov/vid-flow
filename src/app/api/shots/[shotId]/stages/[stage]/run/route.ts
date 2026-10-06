import { NextResponse } from "next/server";
import { queueStageRun, type VideoWorkflow } from "@/lib/comfy/stage-run";
import { STAGES, type StageId } from "@/lib/series/constants";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

function videoWorkflow(value: unknown): VideoWorkflow {
  return value === "flf" ? "flf" : "i2v";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ shotId: string; stage: string }> },
) {
  try {
    const { shotId, stage } = await context.params;
    if (!STAGES.includes(stage as StageId)) {
      return NextResponse.json({ error: "Неизвестный этап" }, { status: 400 });
    }
    let workflow: VideoWorkflow = "i2v";
    if (stage === "video_preview" || stage === "final_render") {
      try {
        const body = (await request.json()) as { workflow?: unknown };
        workflow = videoWorkflow(body.workflow);
      } catch {
        workflow = "i2v";
      }
    }

    const queued = queueStageRun(shotId, stage as StageId, { videoWorkflow: workflow });
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
