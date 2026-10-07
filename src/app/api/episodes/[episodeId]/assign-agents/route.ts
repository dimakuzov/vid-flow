import { NextResponse } from "next/server";
import { assignShotAgents } from "@/lib/series/bulk";
import { normalizeEpisodeId } from "@/lib/series/paths";

export const runtime = "nodejs";

/**
 * Кнопка над столбцом «Кадр» («▶ Агенты по кадрам»): агент из меню — всем кадрам без своего агента.
 * Ничего не запускает. Тело `{ provider, model? }`. Ответ `{ started: [], skipped: [], assigned }`.
 */
export async function POST(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    const body = (await request.json().catch(() => ({}))) as { provider?: unknown; model?: unknown };
    const result = assignShotAgents(episodeId, {
      provider: typeof body.provider === "string" ? body.provider : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось назначить агентов";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
