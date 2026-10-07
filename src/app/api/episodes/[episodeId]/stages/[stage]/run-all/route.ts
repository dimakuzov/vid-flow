import { NextResponse } from "next/server";
import { runStageForAllShots } from "@/lib/series/bulk";
import { STAGES, type StageId } from "@/lib/series/constants";
import { normalizeEpisodeId } from "@/lib/series/paths";

export const runtime = "nodejs";

/**
 * Кнопка над столбцом этапа: агент на этом этапе у всех кадров.
 * Тело `{ provider?, model?, redo? }`. redo — переделать и там, где этап уже пройден. Ответ `{ started, skipped }` — по кадрам, с причинами.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ episodeId: string; stage: string }> },
) {
  try {
    const params = await context.params;
    const episodeId = normalizeEpisodeId(params.episodeId);
    if (!STAGES.includes(params.stage as StageId)) throw new Error("Неизвестный этап");
    let body: { provider?: unknown; model?: unknown; redo?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const result = runStageForAllShots(episodeId, params.stage as StageId, {
      provider: typeof body.provider === "string" ? body.provider : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      redo: body.redo === true,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось запустить этап на всех кадрах";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
