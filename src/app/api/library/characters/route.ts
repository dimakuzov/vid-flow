import { NextResponse } from "next/server";
import { listLibraryCharacterNames } from "@/lib/series/character-base";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Имена папок `data/characters/` для списка «добавить персонажа». */
export async function GET() {
  return NextResponse.json({ characters: listLibraryCharacterNames() });
}
