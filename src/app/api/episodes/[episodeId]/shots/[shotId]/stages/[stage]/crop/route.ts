import { NextResponse } from "next/server";
import { saveCroppedImage } from "@/lib/series/mutations";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

/** Обрезка из браузера. Исходник не меняется, новый PNG — в output/. */
export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const form = await request.formData();
    const file = form.get("file");
    const filename = String(form.get("source") || "");
    const folder = String(form.get("folder") || "");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
    }
    if (folder !== "output" && folder !== "approve") {
      return NextResponse.json({ error: "Обрезать можно файл из output/ или approve/" }, { status: 400 });
    }
    const saved = saveCroppedImage({
      episodeId,
      shotId,
      stageId,
      folder,
      filename,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({
      ...saved,
      message: `Обрезка сохранена: ${saved.savedAs}. Исходник не изменён.`,
      stage: getStageDetail(episodeId, shotId, stageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить обрезку";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
