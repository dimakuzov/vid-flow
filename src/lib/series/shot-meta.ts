import fs from "fs";
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

/**
 * Название кадра в таблице. Меняет заголовок `#` и строку `- title:`, если она есть.
 * Остальной текст shot.md остаётся.
 */
export function setShotTitle(episodeId: string, shotId: string, title: string): string {
  const next = title.trim().replace(/\s+/g, " ");
  if (!next) throw new Error("Название кадра не может быть пустым");
  const file = path.join(shotDir(episodeId, shotId), "shot.md");
  let content = readTextIfExists(file);
  const titleLine = /^(-\s*(?:title|название)\s*:).*$/im;
  if (titleLine.test(content)) content = content.replace(titleLine, `$1 ${next}`);
  if (/^#\s+.+$/m.test(content)) content = content.replace(/^#\s+.+$/m, `# ${next}`);
  else content = content.trim() ? `# ${next}\n\n${content}` : `# ${next}\n\n- characters: \n- location: \n`;
  writeText(file, content.endsWith("\n") ? content : `${content}\n`);
  return next;
}

/** Правка фрагмента сценария в карточке кадра. null — своей правки ещё нет, показывается текст из сырого сценария. */
export function readShotFragment(episodeId: string, shotId: string): string | null {
  const file = path.join(shotDir(episodeId, shotId), "fragment.md");
  if (!fs.existsSync(file)) return null;
  return readTextIfExists(file);
}

/**
 * Сохраняет текст фрагмента в кадре и в раздел Summary shot.md.
 * Заголовок, персонажи и локация не меняются. Этот текст потом читает сборка кадра.
 */
export function setShotFragment(episodeId: string, shotId: string, fragment: string): string {
  const text = fragment.replace(/\r\n/g, "\n");
  writeText(path.join(shotDir(episodeId, shotId), "fragment.md"), text);
  const file = path.join(shotDir(episodeId, shotId), "shot.md");
  let content = readTextIfExists(file);
  const block = `## Summary\n${text.trim()}\n`;
  if (/##\s*Summary\s*\n/i.test(content)) {
    content = content.replace(/##\s*Summary\s*\n[\s\S]*?(?=\n##\s|$)/i, block);
  } else if (content.trim()) {
    content = `${content.trimEnd()}\n\n${block.trimEnd()}`;
  } else {
    content = `# ${shotId}\n\n- characters: \n- location: \n\n${block.trimEnd()}`;
  }
  writeText(file, content.endsWith("\n") ? content : `${content}\n`);
  return text;
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
