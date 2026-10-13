import { NextResponse } from "next/server";
import { setShotHidden } from "@/lib/series/hidden-shots";
import { parseShotParams, type ShotRouteContext } from "@/lib/series/route-params";

export const runtime = "nodejs";

/** Скрыть кадр из таблицы или вернуть. Папка кадра не удаляется. */
export async function POST(request: Request, context: ShotRouteContext) {
  try {
    const { episodeId, shotId } = parseShotParams(await context.params);
    const body = (await request.json()) as { hidden?: unknown };
    if (typeof body.hidden !== "boolean") {
      return NextResponse.json({ error: "Нужно hidden: true или false" }, { status: 400 });
    }
    setShotHidden(episodeId, shotId, body.hidden);
    return NextResponse.json({ shotId, hidden: body.hidden });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось изменить кадр";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
