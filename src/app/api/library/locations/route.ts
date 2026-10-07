import { NextResponse } from "next/server";
import { listLibraryLocations } from "@/lib/series/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Локации из `data/locations/`: id папки и миниатюра общего вида (`/api/media/<thumbnail>`). */
export async function GET() {
  return NextResponse.json({ locations: listLibraryLocations() });
}
