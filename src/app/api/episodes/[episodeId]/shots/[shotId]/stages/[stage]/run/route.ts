import { NextResponse } from "next/server";
import { queueStageRun, type VideoWorkflow } from "@/lib/comfy/stage-run";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

function videoWorkflow(value: unknown): VideoWorkflow {
  return value === "flf" ? "flf" : "i2v";
}

export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    let workflow: VideoWorkflow = "i2v";
    if (stageId === "video_preview" || stageId === "final_render") {
      try {
        const body = (await request.json()) as { workflow?: unknown };
        workflow = videoWorkflow(body.workflow);
      } catch {
        workflow = "i2v";
      }
    }

    const queued = queueStageRun(episodeId, shotId, stageId, { videoWorkflow: workflow });
    return NextResponse.json({
      message: queued.message,
      jobId: queued.id,
      stage: getStageDetail(episodeId, shotId, stageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка запуска";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
