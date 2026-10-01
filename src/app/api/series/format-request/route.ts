import { NextResponse } from "next/server";
import { submitFormatRequest } from "@/lib/series/format-request";
import { agentInboxRelative } from "@/lib/series/paths";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { episodeId?: string; rawText?: string };
    const submitted = submitFormatRequest(body.episodeId || "", body.rawText || "");
    const inbox = agentInboxRelative(submitted.episodeId);
    return NextResponse.json({
      ...submitted,
      inbox,
      message: `Сырой текст записан в эпизод ${submitted.episodeId}. Агент сам не запущен. В Cursor, в папке этого репозитория, напиши: разбери ${inbox} и отформатируй сценарий.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось записать сценарий";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
