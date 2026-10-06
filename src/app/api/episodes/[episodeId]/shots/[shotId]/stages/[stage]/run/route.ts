import { NextResponse } from "next/server";
import { queueStageRun } from "@/lib/comfy/stage-run";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

/** Тело `{ runWorkflow?: string }` — id манифеста. Старое `{ workflow: "i2v" | "flf" }` тоже принимается. */
async function requestedWorkflow(request: Request): Promise<string | undefined> {
  let body: { runWorkflow?: unknown; workflow?: unknown };
  try {
    body = await request.json();
  } catch {
    // Пустое тело: выбор этапа (run_settings.json) или вариант по умолчанию.
    return undefined;
  }
  const raw = body?.runWorkflow ?? body?.workflow;
  if (raw == null || raw === "") return undefined;
  if (typeof raw !== "string") throw new Error("runWorkflow должен быть строкой");
  return raw;
}

export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const workflow = await requestedWorkflow(request);
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
