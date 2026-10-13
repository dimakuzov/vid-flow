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
    let filename = file.name;
    const character = String(form.get("character") || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "");
    // На этапе персонажей файл без префикса имени относится к выбранному персонажу.
    if (target === "refs" && stageId === "characters" && /^[a-z][a-z0-9_]*$/.test(character)) {
      const base = filename.split(/[/\\]/).pop() || filename;
      if (!base.toLowerCase().startsWith(`${character}_`) && !base.toLowerCase().startsWith(`${character}.`)) {
        filename = `${character}_${base}`;
      }
    }
    const saved = await saveUpload({
      episodeId,
      shotId,
      stageId,
      target,
      filename,
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
