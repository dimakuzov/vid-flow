import { NextResponse } from "next/server";
import { createLibraryLocation, listLibraryLocations } from "@/lib/series/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Локации из `data/locations/`: id папки и миниатюра общего вида (`/api/media/<thumbnail>`). */
export async function GET() {
  return NextResponse.json({ locations: listLibraryLocations() });
}

/** Создать пустую папку `data/locations/{name}`. Картинку пользователь кладёт сам. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: string };
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Не указано имя локации" }, { status: 400 });
    }
    const id = createLibraryLocation(body.name);
    return NextResponse.json({ id, locations: listLibraryLocations() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось создать локацию";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
