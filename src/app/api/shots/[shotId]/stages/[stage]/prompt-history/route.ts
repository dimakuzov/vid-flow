import { NextResponse } from "next/server";
import { STAGES, type StageId } from "@/lib/series/constants";
import { restorePromptVersion } from "@/lib/series/prompt-history";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

function parseStage(value: string): StageId {
  if (!STAGES.includes(value as StageId)) {
    throw new Error("Неизвестный этап");
  }
  return value as StageId;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ shotId: string; stage: string }> },
) {
  try {
    const { shotId, stage } = await context.params;
    const stageId = parseStage(stage);
    const body = (await request.json()) as { versionId?: string };
    if (!body.versionId) throw new Error("Не указана версия промпта");
    restorePromptVersion(shotId, stageId, body.versionId);
    return NextResponse.json(getStageDetail(shotId, stageId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка отката";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
