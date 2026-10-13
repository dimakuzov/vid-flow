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

/** Имя для shot.md и файлов: строчная латиница, пробелы — подчёркивание. */
export function normalizeCharacterName(raw: string): string {
  const name = raw.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error("Имя персонажа — латиница, например lena");
  }
  return name;
}

/**
 * Список персонажей кадра. Меняет только строку `- characters:` в shot.md.
 * Остальной текст файла остаётся.
 */
export function setShotCharacters(episodeId: string, shotId: string, names: string[]): string[] {
  const characters: string[] = [];
  for (const raw of names) {
    const name = normalizeCharacterName(raw);
    if (!characters.includes(name)) characters.push(name);
  }
  const file = path.join(shotDir(episodeId, shotId), "shot.md");
  const content = readTextIfExists(file);
  const line = /^(-\s*(?:characters|персонажи)\s*:).*$/im;
  const next = `- characters: ${characters.join(", ")}`;
  if (line.test(content)) {
    writeText(file, content.replace(line, next));
  } else if (content.trim()) {
    writeText(file, content.replace(/^(#.+)$/m, `$1\n\n${next}`));
  } else {
    writeText(file, `# ${shotId}\n\n${next}\n- location: \n`);
  }
  return characters;
}

export function readShotMeta(episodeId: string, shotId: string): ShotMeta {
  const content = readTextIfExists(path.join(shotDir(episodeId, shotId), "shot.md"));
  return parseShotMarkdown(shotId, content);
}

export function writeShotMeta(episodeId: string, meta: ShotMeta): void {
  const body = `# ${meta.title}

- id: ${meta.id}
- characters: ${meta.characters.join(", ")}
- location: ${meta.location}

## Summary
${meta.summary || "Описание кадра пока не задано."}
`;
  writeText(path.join(shotDir(episodeId, meta.id), "shot.md"), body);
}
