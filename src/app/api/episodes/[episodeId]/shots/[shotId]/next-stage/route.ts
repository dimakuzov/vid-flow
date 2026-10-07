import { NextResponse } from "next/server";
import { runNextStageForShot } from "@/lib/series/bulk";
import { parseShotParams, type ShotRouteContext } from "@/lib/series/route-params";

export const runtime = "nodejs";

/**
 * Кнопка на кадре: агент на следующий неутверждённый этап этого кадра.
 * Тело `{ provider?, model? }`. Ответ `{ started, skipped }` (один кадр).
 */
export async function POST(request: Request, context: ShotRouteContext) {
  try {
    const { episodeId, shotId } = parseShotParams(await context.params);
    let body: { provider?: unknown; model?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const result = runNextStageForShot(episodeId, shotId, {
      provider: typeof body.provider === "string" ? body.provider : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось запустить агента на кадре";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
