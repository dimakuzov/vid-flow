import { NextResponse } from "next/server";
import { queueStageRun } from "@/lib/comfy/stage-run";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

/**
 * Тело `{ runWorkflow?: string, allowCloud?: boolean }` — id манифеста и разрешение на платный
 * запуск в Comfy Cloud (на этот запуск). Старое `{ workflow: "i2v" | "flf" }` тоже принимается.
 */
async function readRunBody(request: Request): Promise<{ workflow?: string; allowCloud: boolean }> {
  let body: { runWorkflow?: unknown; workflow?: unknown; allowCloud?: unknown };
  try {
    body = await request.json();
  } catch {
    // Пустое тело: выбор этапа (run_settings.json) или вариант по умолчанию.
    return { allowCloud: false };
  }
  const allowCloud = body?.allowCloud === true;
  const raw = body?.runWorkflow ?? body?.workflow;
  if (raw == null || raw === "") return { allowCloud };
  if (typeof raw !== "string") throw new Error("runWorkflow должен быть строкой");
  return { workflow: raw, allowCloud };
}

export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const { workflow, allowCloud } = await readRunBody(request);
    const queued = queueStageRun(episodeId, shotId, stageId, { workflow, allowCloud });
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
