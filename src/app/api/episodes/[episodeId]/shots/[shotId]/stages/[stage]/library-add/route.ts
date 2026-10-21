import { NextResponse } from "next/server";
import { addImageToCharacterStyled, addImageToLocation } from "@/lib/series/library-add";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";

export const runtime = "nodejs";

/**
 * Картинку из output/ или approve/ этапа — в библиотеку.
 * Персонажи: `{ folder, filename, character }` → `data/characters/{character}/styled/`.
 * Локация: `{ folder, filename }` → папка локации кадра в `data/locations/`.
 */
export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const body = (await request.json()) as { folder?: unknown; filename?: unknown; character?: unknown };
    const folder = typeof body.folder === "string" ? body.folder : "";
    const filename = typeof body.filename === "string" ? body.filename : "";
    if (stageId === "characters") {
      const character = typeof body.character === "string" ? body.character : "";
      if (!character.trim()) return NextResponse.json({ error: "Не выбран персонаж" }, { status: 400 });
      const result = addImageToCharacterStyled({ episodeId, shotId, folder, filename, character });
      return NextResponse.json({
        savedAs: result.savedAs,
        target: result.character,
      });
    }
    if (stageId === "location") {
      const result = addImageToLocation({ episodeId, shotId, folder, filename });
      return NextResponse.json({
        savedAs: result.savedAs,
        target: result.location,
      });
    }
    return NextResponse.json({ error: "В библиотеку можно добавить только на персонажах и локации" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось добавить в библиотеку";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
