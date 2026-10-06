import { NextResponse } from "next/server";
import { updateStageDocs } from "@/lib/series/mutations";
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
    };
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
