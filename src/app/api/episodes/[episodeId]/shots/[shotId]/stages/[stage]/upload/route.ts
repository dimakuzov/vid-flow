import { NextResponse } from "next/server";
import { saveUpload } from "@/lib/series/mutations";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);

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
      episodeId,
      shotId,
      stageId,
      target,
      filename: file.name,
      bytes,
      approveAfter,
    });

    return NextResponse.json({
      ...saved,
      stage: getStageDetail(episodeId, shotId, stageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка загрузки";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
