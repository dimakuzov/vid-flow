import { NextResponse } from "next/server";
import { setShotHidden } from "@/lib/series/hidden-shots";
import { parseShotParams, type ShotRouteContext } from "@/lib/series/route-params";
import { setShotFragment, setShotTitle } from "@/lib/series/shot-meta";

export const runtime = "nodejs";

/** Скрыть кадр из таблицы или вернуть. Папка кадра не удаляется. */
export async function POST(request: Request, context: ShotRouteContext) {
  try {
    const { episodeId, shotId } = parseShotParams(await context.params);
    const body = (await request.json()) as { hidden?: unknown; title?: unknown; fragment?: unknown };
    let hidden: boolean | undefined;
    let title: string | undefined;
    let fragment: string | undefined;
    if (typeof body.hidden === "boolean") {
      setShotHidden(episodeId, shotId, body.hidden);
      hidden = body.hidden;
    }
    if (typeof body.title === "string") title = setShotTitle(episodeId, shotId, body.title);
    if (typeof body.fragment === "string") fragment = setShotFragment(episodeId, shotId, body.fragment);
    if (hidden === undefined && title === undefined && fragment === undefined) {
      return NextResponse.json({ error: "Нужно hidden, title или fragment" }, { status: 400 });
    }
    return NextResponse.json({ shotId, hidden, title, fragment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось изменить кадр";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
