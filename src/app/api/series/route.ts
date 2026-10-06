import { NextResponse } from "next/server";
import { scanSeries } from "@/lib/series/scanner";

export const runtime = "nodejs";

/** Сводка открытого эпизода (`current_episode.txt`). Конкретный эпизод: `/api/episodes/<id>`. */
export async function GET() {
  try {
    const series = scanSeries();
    return NextResponse.json(series);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка чтения серии";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
