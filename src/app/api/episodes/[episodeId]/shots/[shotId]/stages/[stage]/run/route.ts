import { NextResponse } from "next/server";
import { queueStageRun } from "@/lib/comfy/stage-run";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    // runWorkflow — id манифеста; workflow — старое имя поля (i2v, flf). Нет — выбор этапа или вариант по умолчанию.
    let workflow: string | undefined;
    try {
      const body = (await request.json()) as { runWorkflow?: unknown; workflow?: unknown };
      const raw = body.runWorkflow ?? body.workflow;
      if (typeof raw === "string") workflow = raw;
    } catch {
      workflow = undefined;
    }

    const queued = queueStageRun(episodeId, shotId, stageId, { workflow });
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
