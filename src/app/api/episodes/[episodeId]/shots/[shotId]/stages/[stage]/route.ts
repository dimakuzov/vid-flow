import { NextResponse } from "next/server";
import { resolveWorkflowId } from "@/lib/comfy/workflows";
import { updateStageDocs } from "@/lib/series/mutations";
import { writeRunSettings } from "@/lib/series/run-settings";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

export async function GET(_request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    return NextResponse.json(getStageDetail(episodeId, shotId, stageId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка этапа";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const body = (await request.json()) as {
      prompt?: string;
      llmNotes?: string;
      refs?: string;
      workflow?: string;
      /** Выбор графа (id манифеста). Пустая строка — вернуть вариант по умолчанию. */
      runWorkflow?: string;
    };
    if (typeof body.runWorkflow === "string") {
      const workflow = body.runWorkflow.trim()
        ? resolveWorkflowId(episodeId, shotId, stageId, body.runWorkflow)
        : null;
      writeRunSettings(episodeId, shotId, stageId, { workflow: workflow ?? undefined });
    }
    updateStageDocs({
      episodeId,
      shotId,
      stageId,
      prompt: body.prompt,
      llmNotes: body.llmNotes,
      refs: body.refs,
      workflow: body.workflow,
    });
    return NextResponse.json(getStageDetail(episodeId, shotId, stageId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка сохранения";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
