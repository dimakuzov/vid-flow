import { NextResponse } from "next/server";
import { restorePromptVersion } from "@/lib/series/prompt-history";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const body = (await request.json()) as { versionId?: string };
    if (!body.versionId) throw new Error("Не указана версия промпта");
    restorePromptVersion(episodeId, shotId, stageId, body.versionId);
    return NextResponse.json(getStageDetail(episodeId, shotId, stageId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка отката";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
