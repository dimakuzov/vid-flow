import { NextResponse } from "next/server";
import { runNextStageForAllShots } from "@/lib/series/bulk";
import { normalizeEpisodeId } from "@/lib/series/paths";

export const runtime = "nodejs";

/**
 * Кнопка над столбцом «Кадр»: каждому кадру — агент на его следующий неутверждённый этап.
 * Тело `{ provider? }`. Ответ `{ started, skipped }` — по кадрам, с этапом и причиной.
 */
export async function POST(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    let body: { provider?: unknown; model?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const result = runNextStageForAllShots(episodeId, {
      provider: typeof body.provider === "string" ? body.provider : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось запустить агентов по кадрам";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
