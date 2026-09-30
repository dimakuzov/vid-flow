import { NextResponse } from "next/server";
import { STAGES, type StageId } from "@/lib/series/constants";
import { approveFiles } from "@/lib/series/mutations";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ shotId: string; stage: string }> },
) {
  try {
    const { shotId, stage } = await context.params;
    if (!STAGES.includes(stage as StageId)) {
      return NextResponse.json({ error: "Неизвестный этап" }, { status: 400 });
    }

    const body = (await request.json()) as {
      filenames?: string[];
      from?: "output" | "refs";
    };

    if (!body.filenames?.length) {
      return NextResponse.json({ error: "Не выбраны файлы" }, { status: 400 });
    }

    const approved = approveFiles({
      shotId,
      stageId: stage as StageId,
      filenames: body.filenames,
      from: body.from || "output",
    });

    return NextResponse.json({
      approved,
      stage: getStageDetail(shotId, stage as StageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка утверждения";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
