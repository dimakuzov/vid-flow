import { NextResponse } from "next/server";
import { normalizeEpisodeId } from "@/lib/series/paths";
import { addMusicFile } from "@/lib/post/music";

export const runtime = "nodejs";

/** Кнопка «Добавить музыку»: файл кладётся в post/music и потом идёт в дорожку «Музыка». */
export async function POST(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Нужен файл музыки" }, { status: 400 });
    const saved = addMusicFile(episodeId, file.name, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ file: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось добавить музыку";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
