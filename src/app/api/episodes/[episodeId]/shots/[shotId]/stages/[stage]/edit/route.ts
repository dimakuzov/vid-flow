import { NextResponse } from "next/server";
import { listEditWorkflows, queueImageEdit, syncEditFiles } from "@/lib/comfy/edit";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";

export const runtime = "nodejs";

/** Подписи «из чего сделан» и список воркфлоу правки. */
export async function GET(_request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    return NextResponse.json({
      edits: syncEditFiles(episodeId, shotId, stageId),
      workflows: listEditWorkflows(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось прочитать правки";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Правка моделью. Тело: `{ filename, folder, workflow, text }`. Исходник не меняется. */
export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const body = (await request.json()) as {
      filename?: unknown;
      folder?: unknown;
      workflow?: unknown;
      text?: unknown;
    };
    if (body.folder !== "output" && body.folder !== "approve") {
      return NextResponse.json({ error: "Править можно файл из output/ или approve/" }, { status: 400 });
    }
    if (typeof body.filename !== "string" || typeof body.workflow !== "string" || typeof body.text !== "string") {
      return NextResponse.json({ error: "Нужны файл, воркфлоу и текст правки" }, { status: 400 });
    }
    const result = await queueImageEdit({
      episodeId,
      shotId,
      stageId,
      folder: body.folder,
      filename: body.filename,
      workflowId: body.workflow,
      text: body.text,
      signal: request.signal,
    });
    return NextResponse.json({
      ...result,
      edits: syncEditFiles(episodeId, shotId, stageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось поставить правку";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
