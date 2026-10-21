import { NextResponse } from "next/server";
import { copyStyledToApprove, listStyledImages } from "@/lib/series/library-add";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";
import { readShotMeta } from "@/lib/series/shot-meta";

export const runtime = "nodejs";

/** Одетые картинки персонажей этого кадра из `data/characters/{name}/styled/`. */
export async function GET(_request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    if (stageId !== "characters") {
      return NextResponse.json({ error: "Список есть только на персонажах" }, { status: 400 });
    }
    return NextResponse.json({ files: listStyledImages(readShotMeta(episodeId, shotId).characters) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось прочитать styled/";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Скопировать выбранные картинки в approve/ персонажей. Тело: `{ paths }`. */
export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    if (stageId !== "characters") {
      return NextResponse.json({ error: "Так можно добавить только на персонажах" }, { status: 400 });
    }
    const body = (await request.json()) as { paths?: unknown };
    const paths = Array.isArray(body.paths) ? body.paths.filter((item): item is string => typeof item === "string") : [];
    const savedAs = copyStyledToApprove(episodeId, shotId, paths);
    return NextResponse.json({
      savedAs,
      message: `В approve/: ${savedAs.join(", ")}.`,
      stage: getStageDetail(episodeId, shotId, stageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось добавить из библиотеки";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
