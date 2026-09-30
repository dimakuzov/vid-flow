import { NextResponse } from "next/server";
import { STAGES, type StageId } from "@/lib/series/constants";
import { updateStageDocs } from "@/lib/series/mutations";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

function parseStage(value: string): StageId {
  if (!STAGES.includes(value as StageId)) {
    throw new Error("Неизвестный этап");
  }
  return value as StageId;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ shotId: string; stage: string }> },
) {
  try {
    const { shotId, stage } = await context.params;
    const detail = getStageDetail(shotId, parseStage(stage));
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка этапа";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ shotId: string; stage: string }> },
) {
  try {
    const { shotId, stage } = await context.params;
    const stageId = parseStage(stage);
    const body = (await request.json()) as {
      prompt?: string;
      llmNotes?: string;
      refs?: string;
      workflow?: string;
    };
    updateStageDocs({ shotId, stageId, ...body });
    return NextResponse.json(getStageDetail(shotId, stageId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка сохранения";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
