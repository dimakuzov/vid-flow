import { NextResponse } from "next/server";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { copyPreviousApproveToRefs } from "@/lib/series/prev-shot";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

/** Картинки из approve/ предыдущего кадра копируются в refs/ этого. Локация и персонажи. */
export async function POST(_request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const savedAs = copyPreviousApproveToRefs({ episodeId, shotId, stageId });
    return NextResponse.json({
      savedAs,
      message: `В refs/ из предыдущего кадра: ${savedAs.join(", ")}.`,
      stage: getStageDetail(episodeId, shotId, stageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось добавить из предыдущего кадра";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
