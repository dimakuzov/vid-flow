// Переводит старые prompt.md в «текст для модели»: убирает русские строки и инструкции доски,
// оставляет английскую часть. По умолчанию только показывает план; пишет с --write.
//
//   npm run migrate-prompts                    # все эпизоды, без записи
//   npm run migrate-prompts -- --episode teaser
//   npm run migrate-prompts -- --write         # записать; прошлая версия уйдёт в prompt_history.json
//
// Этап, у которого нет английской части, не трогается: его промпт пишет агент.
// Занятые этапы (агент, очередь, генерация) пропускаются.
import fs from "fs";
import path from "path";
import { BOARD_INSTRUCTION, russianLine } from "../src/lib/comfy/binding";
import { STAGES, type StageId } from "../src/lib/series/constants";
import { updateStageDocs } from "../src/lib/series/mutations";
import { listEpisodeIds, listShotIds, stageDir } from "../src/lib/series/paths";
import { readStageState } from "../src/lib/series/stage-state";

const VIDEO_STAGES: StageId[] = ["video_preview", "final_render"];

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

/** Пометки про звук: модели картинки и Wan-превью они не нужны. */
const SOUND_NOTE = /^\s*(SFX|Audio(\s*&\s*FX)?|Sound)\s*:/i;
/** Ветки графа локации по порядку (location_views.bind.json). */
const LOCATION_SECTIONS = ["simple", "objects", "camera", "camera_objects"];

function isModelLine(line: string): boolean {
  return (
    !russianLine(line) && !BOARD_INSTRUCTION.test(line) && !SOUND_NOTE.test(line) && !/^\s*-{3,}\s*$/.test(line)
  );
}

export type Migration =
  | { kind: "write"; text: string }
  | { kind: "agent" }
  | { kind: "review"; text: string; reason: string };

function opening(paragraph: string): string {
  return paragraph.toLowerCase().split(/\s+/).slice(0, 4).join(" ");
}

/** Локация «v1: … v2: …» — те же четыре ветки графа: переводим в разделы ## simple … ## camera_objects. */
function locationSections(text: string): string | null {
  const branches = new Map<number, string[]>();
  let current: number | null = null;
  for (const line of text.split("\n")) {
    if (/^\s*-{3,}\s*$/.test(line)) continue;
    const start = line.match(/^\s*v([1-4])\s*:\s*(.*)$/i);
    if (start) {
      current = Number(start[1]);
      if (branches.has(current)) return null;
      branches.set(current, [start[2]]);
    } else if (current !== null) {
      branches.get(current)!.push(line);
    } else if (line.trim()) {
      return null;
    }
  }
  if (!branches.size) return null;
  const body = new Map([...branches].map(([n, lines]) => [n, lines.join("\n").trim()]));
  // «v4: v3 + In frame: …» — ссылка на текст другой ветки.
  for (const [n, value] of body) {
    const ref = value.match(/^v([1-4])\s*\+\s*([\s\S]*)$/i);
    if (ref && body.has(Number(ref[1])) && Number(ref[1]) !== n) {
      body.set(n, `${body.get(Number(ref[1]))} ${ref[2].trim()}`);
    }
  }
  return [...body]
    .sort(([a], [b]) => a - b)
    .map(([n, value]) => `## ${LOCATION_SECTIONS[n - 1]}\n${value}`)
    .join("\n\n");
}

/** Что сделать с промптом: записать, отдать агенту (английской части нет) или показать человеку. */
export function migratePrompt(text: string, stageId: StageId): Migration {
  const lines = text.split(/\r?\n/);
  const kept = lines.filter(isModelLine);
  const dropped = lines.filter((line) => !isModelLine(line));
  let next = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!/[a-zA-Z]{3}/.test(next)) return { kind: "agent" };
  if (stageId === "location") {
    const sections = locationSections(next);
    if (sections) return { kind: "write", text: sections };
  }
  // Несколько вариантов одного текста подряд (история попыток): какой оставить, решает человек.
  const paragraphs = next.split(/\n\s*\n/).filter((part) => part.trim());
  const openings = paragraphs.map(opening);
  if (new Set(openings).size < openings.length) {
    return { kind: "review", text: next, reason: "несколько вариантов текста подряд — оставь один вручную" };
  }
  // Видео: длительность часто была только в русской строке («6 секунд»). Плейбук Wan
  // просит писать её последними словами: «N sec».
  if (VIDEO_STAGES.includes(stageId) && !/\b\d+(?:[.,]\d+)?\s*(?:sec|s)\b/i.test(next)) {
    const seconds = dropped.join(" ").match(/(\d+(?:[.,]\d+)?)\s*(?:секунд\w*|сек\b)/i);
    if (seconds) next = `${next} ${seconds[1].replace(",", ".")} sec`;
  }
  return { kind: "write", text: next };
}

function main(): void {
  const write = process.argv.includes("--write");
  const only = arg("--episode");
  const episodes = only ? [only] : listEpisodeIds();
  let changed = 0;
  let needAgent = 0;
  let review = 0;
  for (const episodeId of episodes) {
    for (const shotId of listShotIds(episodeId)) {
      for (const stageId of STAGES) {
        const file = path.join(stageDir(episodeId, shotId, stageId), "prompt.md");
        let text = "";
        try {
          text = fs.readFileSync(file, "utf8");
        } catch {
          continue;
        }
        if (!text.trim() || (!russianLine(text) && !BOARD_INSTRUCTION.test(text))) continue;
        const where = `${episodeId}/${shotId}/${stageId}`;
        if (readStageState(episodeId, shotId, stageId).busy) {
          console.log(`- ${where}: этап занят, пропускаю`);
          continue;
        }
        const result = migratePrompt(text, stageId);
        if (result.kind === "agent") {
          needAgent += 1;
          console.log(`- ${where}: английской части нет — промпт пишет агент`);
          continue;
        }
        if (result.kind === "review") {
          review += 1;
          console.log(`? ${where}: ${result.reason}, не трогаю\n${indent(result.text)}\n`);
          continue;
        }
        changed += 1;
        console.log(`+ ${where}: ${write ? "записано" : "будет записано"}\n${indent(result.text)}\n`);
        if (write) updateStageDocs({ episodeId, shotId, stageId, prompt: `${result.text}\n` });
      }
    }
  }
  console.log(
    `\nИтого: ${changed} переписать${write ? "" : " (без --write ничего не записано)"}, ` +
      `${review} — выбрать вариант вручную, ${needAgent} — к агенту.`,
  );
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

if (process.argv[1] && path.basename(process.argv[1]).startsWith("migrate-prompts")) main();
