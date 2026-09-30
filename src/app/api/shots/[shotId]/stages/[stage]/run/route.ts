import { NextResponse } from "next/server";
import { STAGES, type StageId } from "@/lib/series/constants";
import { setWaiting } from "@/lib/series/mutations";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ shotId: string; stage: string }> },
) {
  try {
    const { shotId, stage } = await context.params;
    if (!STAGES.includes(stage as StageId)) {
      return NextResponse.json({ error: "Неизвестный этап" }, { status: 400 });
    }

    // Comfy adapter will replace this stub: mark waiting until artifacts arrive.
    setWaiting(shotId, stage as StageId);

    return NextResponse.json({
      message:
        "Этап переведён в ожидание. Подключение локальной Comfy будет следующим шагом; пока положите результат в output/ вручную или через загрузку.",
      stage: getStageDetail(shotId, stage as StageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка запуска";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
