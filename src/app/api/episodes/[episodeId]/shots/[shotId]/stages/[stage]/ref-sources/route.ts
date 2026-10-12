import { NextResponse } from "next/server";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { copyRefSources, listRefSources } from "@/lib/series/ref-sources";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

/** Сетка «Добавить референс из…»: библиотеки, другие этапы кадра, тот же этап других кадров. */
export async function GET(_request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    return NextResponse.json({ groups: listRefSources(episodeId, shotId, stageId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось прочитать источники";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Скопировать выбранные файлы в refs/. Тело: `{ paths: string[] }`. */
export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const body = (await request.json()) as { paths?: unknown };
    const paths = Array.isArray(body.paths) ? body.paths.filter((item): item is string => typeof item === "string") : [];
    const savedAs = copyRefSources({ episodeId, shotId, stageId, paths });
    return NextResponse.json({
      savedAs,
      message: `В refs/: ${savedAs.join(", ")}.`,
      stage: getStageDetail(episodeId, shotId, stageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось добавить референс";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
