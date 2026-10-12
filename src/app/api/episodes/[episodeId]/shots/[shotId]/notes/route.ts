import { NextResponse } from "next/server";
import { parseShotParams, type ShotRouteContext } from "@/lib/series/route-params";
import { deleteShotNote } from "@/lib/series/shot-notes";

export const runtime = "nodejs";

/** Убрать замечание из истории кадра: `{ id }`. Агент его больше не увидит. */
export async function DELETE(request: Request, context: ShotRouteContext) {
  try {
    const { episodeId, shotId } = parseShotParams(await context.params);
    const body = (await request.json()) as { id?: unknown };
    if (typeof body.id !== "string" || !deleteShotNote(episodeId, shotId, body.id)) {
      throw new Error("Такого замечания нет");
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось убрать замечание";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
