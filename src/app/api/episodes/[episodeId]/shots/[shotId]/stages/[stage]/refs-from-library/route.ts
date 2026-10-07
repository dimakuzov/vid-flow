import { NextResponse } from "next/server";
import { copyLocationToRefs } from "@/lib/series/library";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

/**
 * Общий вид локации из `data/locations/{locationId}/` → `refs/{locationId}_view{ext}` этапа.
 * `writeToShot: true` — ещё и `- location:` в shot.md. Ответ — `{ message, savedAs, stage }`.
 */
export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const body = (await request.json()) as { locationId?: string; writeToShot?: boolean };
    if (!body.locationId) {
      return NextResponse.json({ error: "Не выбрана локация" }, { status: 400 });
    }
    const result = copyLocationToRefs({
      episodeId,
      shotId,
      stageId,
      locationId: body.locationId,
      writeToShot: body.writeToShot === true,
    });
    const parts = [
      result.existed
        ? `${result.savedAs} уже есть в refs/, не перезаписан.`
        : `В refs/: ${result.savedAs}.`,
    ];
    if (result.shotLocation) parts.push(`В кадре локация: ${result.shotLocation}.`);
    return NextResponse.json({
      message: parts.join(" "),
      savedAs: result.savedAs,
      stage: getStageDetail(episodeId, shotId, stageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось взять локацию";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
