import { NextResponse } from "next/server";
import { normalizeEpisodeId } from "@/lib/series/paths";
import { getPostState } from "@/lib/post/state";
import { setCurrentVoice, writeVoiceConfig } from "@/lib/post/voices";

export const runtime = "nodejs";

/**
 * Голос персонажа. В ElevenLabs ничего не уходит. Ответ — состояние поста.
 * `PUT { character, voice_id, model_id?, voice_settings?, seed? }` — пишет `data/characters/{Name}/voice.json`.
 * `POST { character, version }` — сделать версию озвучки текущей.
 */
export async function PUT(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.character !== "string" || !body.character.trim()) throw new Error("Нет персонажа");
    writeVoiceConfig(body.character, body);
    return NextResponse.json(await getPostState(episodeId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить голос";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  try {
    const episodeId = normalizeEpisodeId((await context.params).episodeId);
    const body = (await request.json().catch(() => ({}))) as { character?: unknown; version?: unknown };
    if (typeof body.character !== "string" || typeof body.version !== "number") throw new Error("Нужны character и version");
    setCurrentVoice(episodeId, body.character, body.version);
    return NextResponse.json(await getPostState(episodeId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось выбрать версию";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
