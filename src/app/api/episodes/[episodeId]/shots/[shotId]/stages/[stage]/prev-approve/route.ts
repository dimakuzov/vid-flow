import { NextResponse } from "next/server";
import {
  copyPickedCharacterApproves,
  copyPreviousCharacterApprove,
  listEarlierCharacterApproves,
} from "@/lib/series/prev-shot";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

/** Утверждённые картинки персонажей из кадров до этого. */
export async function GET(_request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    if (stageId !== "characters") {
      return NextResponse.json({ error: "Список есть только на персонажах" }, { status: 400 });
    }
    return NextResponse.json({ files: listEarlierCharacterApproves(episodeId, shotId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось прочитать прошлые кадры";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Скопировать approve персонажа. Тело: `{ mode: "previous" }` или `{ mode: "pick", paths }`. */
export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    if (stageId !== "characters") {
      return NextResponse.json({ error: "Так можно добавить только на персонажах" }, { status: 400 });
    }
    const body = (await request.json()) as { mode?: unknown; paths?: unknown };
    const savedAs =
      body.mode === "previous"
        ? copyPreviousCharacterApprove(episodeId, shotId)
        : body.mode === "pick" && Array.isArray(body.paths)
          ? copyPickedCharacterApproves(
              episodeId,
              shotId,
              body.paths.filter((item): item is string => typeof item === "string"),
            )
          : null;
    if (!savedAs) {
      return NextResponse.json({ error: "Нужен предыдущий кадр или выбранные файлы" }, { status: 400 });
    }
    return NextResponse.json({
      savedAs,
      message: `В approve/: ${savedAs.join(", ")}.`,
      stage: getStageDetail(episodeId, shotId, stageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось добавить из кадра";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
