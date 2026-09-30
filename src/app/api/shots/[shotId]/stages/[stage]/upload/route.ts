import { NextResponse } from "next/server";
import { STAGES, type StageId } from "@/lib/series/constants";
import { saveUpload } from "@/lib/series/mutations";
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

    const form = await request.formData();
    const file = form.get("file");
    const target = String(form.get("target") || "output");
    const approveAfter = String(form.get("approveAfter") || "") === "true";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
    }
    if (target !== "refs" && target !== "output") {
      return NextResponse.json({ error: "target должен быть refs или output" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const saved = await saveUpload({
      shotId,
      stageId: stage as StageId,
      target,
      filename: file.name,
      bytes,
      approveAfter,
    });

    return NextResponse.json({
      ...saved,
      stage: getStageDetail(shotId, stage as StageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка загрузки";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
