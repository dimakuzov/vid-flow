import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getScenariosRoot } from "@/lib/series/paths";

export const runtime = "nodejs";

const TEXT_EXT = new Set([".md", ".txt"]);

/** Сценарии из библиотеки `data/scenarios/` (только текстовые файлы верхнего уровня). */
export async function GET() {
  try {
    const root = getScenariosRoot();
    let names: string[] = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      names = [];
    }
    const scenarios = names
      .filter((name) => TEXT_EXT.has(path.extname(name).toLowerCase()))
      .map((name) => {
        const stat = fs.statSync(path.join(root, name));
        return { name, bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
      })
      .filter((item) => item.bytes > 0)
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return NextResponse.json({ scenarios });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось прочитать сценарии";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
