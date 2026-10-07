import { NextResponse } from "next/server";
import { runNextStageForShot } from "@/lib/series/bulk";
import { parseShotParams, type ShotRouteContext } from "@/lib/series/route-params";

export const runtime = "nodejs";

/**
 * Меню агента кадра, «Запустить следующий этап»: агент кадра на следующий неутверждённый этап.
 * Тело `{ provider?, model? }`: с provider этот выбор сначала сохраняется агентом кадра (agent.json).
 * Ответ `{ started, skipped, assigned }` (один кадр).
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
      assign: "always",
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось запустить агента на кадре";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
