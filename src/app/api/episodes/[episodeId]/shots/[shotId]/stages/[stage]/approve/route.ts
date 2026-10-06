import { NextResponse } from "next/server";
import { approveFiles, removeApprovedFile } from "@/lib/series/mutations";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const body = (await request.json()) as {
      filenames?: string[];
      from?: "output" | "refs";
    };

    if (!body.filenames?.length) {
      return NextResponse.json({ error: "Не выбраны файлы" }, { status: 400 });
    }

    const approved = approveFiles({
      episodeId,
      shotId,
      stageId,
      filenames: body.filenames,
      from: body.from || "output",
    });

    return NextResponse.json({
      approved,
      stage: getStageDetail(episodeId, shotId, stageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка утверждения";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const body = (await request.json()) as { filename?: string };
    if (!body.filename) {
      return NextResponse.json({ error: "Не выбран файл" }, { status: 400 });
    }
    const removed = removeApprovedFile(episodeId, shotId, stageId, body.filename);
    return NextResponse.json({
      removed,
      stage: getStageDetail(episodeId, shotId, stageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось убрать файл";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
