import fs from "fs";
import { NextResponse } from "next/server";
import { shotDir } from "@/lib/series/paths";
import { parseShotParams, type ShotRouteContext } from "@/lib/series/route-params";
import { saveUserAction } from "@/lib/series/shot-action";

export const runtime = "nodejs";

/**
 * «Сохранить» действия кадра на странице этапа: `{ text }` → `shots/{shotId}/action.md`,
 * версия пользователя. Пустой текст — убрать: агент напишет действие заново.
 */
export async function PUT(request: Request, context: ShotRouteContext) {
  try {
    const { episodeId, shotId } = parseShotParams(await context.params);
    if (!fs.existsSync(shotDir(episodeId, shotId))) throw new Error(`Кадра ${shotId} нет`);
    const body = (await request.json()) as { text?: unknown };
    saveUserAction(episodeId, shotId, typeof body.text === "string" ? body.text : "");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить действие";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
