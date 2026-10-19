import { NextResponse } from "next/server";
import { prepareUserShot } from "@/lib/series/shot-prepare";
import { parseShotParams, type ShotRouteContext } from "@/lib/series/route-params";

export const runtime = "nodejs";

/** «Подготовить кадр»: по тексту карточки заполняет персонажей, локацию, реплики, длительность и действие. */
export async function POST(request: Request, context: ShotRouteContext) {
  try {
    const { episodeId, shotId } = parseShotParams(await context.params);
    const body = (await request.json()) as { text?: unknown };
    if (typeof body.text !== "string") return NextResponse.json({ error: "Нужен текст кадра" }, { status: 400 });
    await prepareUserShot(episodeId, shotId, body.text);
    return NextResponse.json({ shotId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось подготовить кадр";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
