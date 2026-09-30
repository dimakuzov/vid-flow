import path from "path";
import { readTextIfExists, writeText } from "./media";
import { shotDir } from "./paths";

export interface ShotMeta {
  id: string;
  title: string;
  summary: string;
  characters: string[];
  location: string;
}

function parseList(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseShotMarkdown(shotId: string, content: string): ShotMeta {
  const lines = content.split(/\r?\n/);
  let title = shotId;
  let summary = "";
  let characters: string[] = [];
  let location = "";

  for (const line of lines) {
    const heading = line.match(/^#\s+(.+)$/);
    if (heading) {
      title = heading[1].trim();
      continue;
    }
    const meta = line.match(/^-\s*([^:]+):\s*(.+)$/i);
    if (meta) {
      const key = meta[1].trim().toLowerCase();
      const value = meta[2].trim();
      if (key === "title" || key === "название") title = value;
      if (key === "characters" || key === "персонажи") characters = parseList(value);
      if (key === "location" || key === "локация") location = value;
      continue;
    }
  }

  const summaryMatch = content.match(/##\s*Summary\s*\n([\s\S]*?)(\n##|$)/i);
  if (summaryMatch) {
    summary = summaryMatch[1].trim();
  } else {
    summary = lines
      .filter((line) => line.trim() && !line.startsWith("#") && !line.startsWith("-"))
      .join("\n")
      .trim();
  }

  return { id: shotId, title, summary, characters, location };
}

export function readShotMeta(shotId: string): ShotMeta {
  const content = readTextIfExists(path.join(shotDir(shotId), "shot.md"));
  return parseShotMarkdown(shotId, content);
}

export function writeShotMeta(meta: ShotMeta): void {
  const body = `# ${meta.title}

- id: ${meta.id}
- characters: ${meta.characters.join(", ")}
- location: ${meta.location}

## Summary
${meta.summary || "Описание кадра пока не задано."}
`;
  writeText(path.join(shotDir(meta.id), "shot.md"), body);
}
