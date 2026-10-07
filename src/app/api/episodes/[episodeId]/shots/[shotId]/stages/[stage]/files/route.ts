import { NextResponse } from "next/server";
import { deleteStageFile } from "@/lib/series/mutations";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

/** Удалить файл из output/ или refs/ этапа насовсем. Ответ — StageDetail. */
export async function DELETE(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const body = (await request.json()) as { folder?: string; filename?: string };
    if (body.folder !== "output" && body.folder !== "refs") {
      return NextResponse.json({ error: "Папка — output или refs" }, { status: 400 });
    }
    if (!body.filename) {
      return NextResponse.json({ error: "Не выбран файл" }, { status: 400 });
    }
    deleteStageFile(episodeId, shotId, stageId, body.folder, body.filename);
    return NextResponse.json(getStageDetail(episodeId, shotId, stageId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось удалить файл";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
