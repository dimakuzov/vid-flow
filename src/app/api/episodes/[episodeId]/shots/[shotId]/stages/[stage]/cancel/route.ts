import { NextResponse } from "next/server";
import { cancelStage } from "@/lib/series/agent-dispatch";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";
import { readStageState } from "@/lib/series/stage-state";

export const runtime = "nodejs";

export async function POST(_request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const wasError = readStageState(episodeId, shotId, stageId).phase === "error";
    await cancelStage(episodeId, shotId, stageId);
    return NextResponse.json({
      message: wasError ? "Ошибка сброшена. Этап снова свободен." : "Операция отменена. Этап снова свободен.",
      stage: getStageDetail(episodeId, shotId, stageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отменить";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
