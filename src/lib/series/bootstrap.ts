import fs from "fs";
import path from "path";
import { STAGES, type StageId } from "./constants";
import { writeText } from "./media";
import { parseBackLine, parseFramingLine, seedFraming } from "./first-frame-settings";
import { createEpisode, ensureStageDirs, episodeRoot, stageDir } from "./paths";
import { readRunSettings, writeRunSettings } from "./run-settings";
import { writeShotMeta, type ShotMeta } from "./shot-meta";
import { readShotSpeech, writeShotSpeech } from "./speech";
import { writeStatusFile } from "./status";
import type { BootstrapPreview, BootstrapShotDraft } from "./types";

function normalizeShotId(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) throw new Error(`Не удалось распознать id кадра: ${raw}`);
  return `s${digits.padStart(2, "0")}`;
}

function parseCharacters(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter(Boolean);
}

export function parseScenario(content: string): BootstrapPreview {
  const lines = content.split(/\r?\n/);
  const title =
    lines.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim() ||
    "Серия";

  const shots: BootstrapShotDraft[] = [];
  let current: BootstrapShotDraft | null = null;

  const flush = () => {
    if (current) shots.push(current);
    current = null;
  };

  for (const line of lines) {
    const shotHeading = line.match(
      /^##\s*(s?\d+)\s*[—:\-–]?\s*(.+)?$/i,
    );
    if (shotHeading) {
      flush();
      const id = normalizeShotId(shotHeading[1]);
      current = {
        id,
        title: (shotHeading[2] || id).trim(),
        summary: "",
        characters: [],
        location: "",
      };
      continue;
    }

    if (!current) continue;

    const meta = line.match(/^-\s*([^:]+):\s*(.+)$/i);
    if (meta) {
      const key = meta[1].trim().toLowerCase();
      const value = meta[2].trim();
      if (key.startsWith("char") || key.includes("персонаж")) {
        current.characters = parseCharacters(value);
      } else if (key.startsWith("loc") || key.includes("локац")) {
        current.location = value;
      } else if (key === "title" || key === "название") {
        current.title = value;
      } else if (key.startsWith("speech") || key.startsWith("line") || key.includes("реплик")) {
        // Одна реплика на строку `- speech:`, дословно, с именем говорящего.
        current.speech = [...(current.speech ?? []), value];
      } else if (key.startsWith("duration") || key.includes("длительн")) {
        const seconds = Number(value.replace(",", ".").match(/\d+(?:\.\d+)?/)?.[0]);
        if (Number.isFinite(seconds) && seconds > 0) current.durationSec = Math.round(seconds);
      } else if (key.startsWith("framing") || key.includes("дальност")) {
        current.framing = { ...(current.framing ?? {}), ...parseFramingLine(value) };
        current.backView = [...(current.backView ?? []), ...parseBackLine(value)];
      }
      continue;
    }

    if (line.trim() && !line.startsWith("#")) {
      current.summary = current.summary
        ? `${current.summary}\n${line.trim()}`
        : line.trim();
    }
  }
  flush();

  return { seriesTitle: title, shots };
}

function defaultRefs(stageId: StageId, shot: BootstrapShotDraft): string {
  if (stageId === "characters") {
    const names = shot.characters.length ? shot.characters.join(", ") : "{name}";
    return `# Refs\n\nImage 1: refs/{name}_base.* (if you put one there), otherwise data/characters/{name}/full_body.png.\nImage 2: refs/{name}_clothes.* is the clothing sample. No file: the "image 2: clothing sample" node is bypassed.\nShot characters: ${names}.\nOther files in refs/ do not go into this graph.\nSee playbooks/stages/characters.en.md.\n`;
  }
  if (stageId === "location") {
    const location = shot.location || "{locationId}";
    return `# Refs\n\nBase: data/locations/${location}/view.png and description.txt.\nIn this shot's refs/: the general view and, if you need another angle, angle.png.\nThe shot variant goes to output/ and approve/.\nSee playbooks/stages/location.en.md.\n`;
  }
  if (stageId === "first_frame") {
    if (!shot.characters.length && !shot.location.trim()) {
      return `# Refs\n\nThere are no characters and no location. The earlier stages are not needed.\nPut the shot's files in this stage's refs/.\nSee playbooks/stages/first_frame.en.md, section "No character and no location".\n`;
    }
    const names = shot.characters.length ? shot.characters.join(", ") : "{name}";
    return `# Refs\n\nIf the characters and location are already approved: the location is from shots/${shot.id}/location/approve/, the characters ${names} are from shots/${shot.id}/characters/approve/{name}_${shot.id}.png.\nIf they are not there, do not wait for those stages. Put the shot's files in refs/ here.\nSee playbooks/stages/first_frame.en.md.\n`;
  }
  return `# Refs\n\nDescribe which files from refs/ are used and why.\n`;
}

function defaultWorkflow(stageId: StageId): string {
  const note = `# Workflow\n\nAn optional note for this shot. It can stay empty.\n\nIf needed, write how the run differs from the graph template. The graph is not chosen here.\n`;
  if (stageId === "characters") {
    return `# Workflow\n\nAn optional note for this shot. It can stay empty.\n\nThe board changes the outfit: manifest character_outfit, graph character_outfit_qwen21.json. Image 1 is the base, image 2 is refs/{name}_clothes.* if present. The prompt is the ## name sections in prompt.md. Playbook: playbooks/models/qwen_outfit.en.md.\n`;
  }
  if (stageId === "location") {
    return `# Workflow\n\nAn optional note for this shot. It can stay empty.\n\nIf needed, write how the run differs from the graph template: which angle, which prompt branch. The graph is not chosen here.\n\nTemplate: playbooks/workflows/comfy/location_views_multiple_angles.json\n`;
  }
  if (stageId === "first_frame") {
    return `# Workflow\n\nAn optional note for this shot. It can stay empty.\n\nIf needed, write how the run differs from the graph template: assembly or edit mode, how many characters. The graph is not chosen here.\n\nTemplate: playbooks/workflows/comfy/qwen21_character_compositing.json\n`;
  }
  return note;
}

/** Пределы длительности клипа на этапе видео (манифесты video_i2v / video_flf). */
const DURATION_MIN = 2;
const DURATION_MAX = 12;

/**
 * Реплики и длительность из разметки сценария: `speech.md` кадра и `durationSec` этапа видео.
 * Их потом видит агент (llm_task.md, text-режим) и граф. Ручные правки не затираются без overwrite.
 */
function seedShotSpeechAndDuration(episodeId: string, shot: BootstrapShotDraft, overwrite: boolean): void {
  const speech = (shot.speech ?? []).map((line) => line.trim()).filter(Boolean);
  if (speech.length && (overwrite || !readShotSpeech(episodeId, shot.id).trim())) {
    writeShotSpeech(episodeId, shot.id, speech.join("\n"));
  }
  if (shot.durationSec != null) {
    const seconds = Math.min(DURATION_MAX, Math.max(DURATION_MIN, shot.durationSec));
    const settings = readRunSettings(episodeId, shot.id, "video_preview");
    if (overwrite || settings.durationSec == null) {
      writeRunSettings(episodeId, shot.id, "video_preview", { ...settings, durationSec: seconds });
    }
  }
}

function seedStageDocs(episodeId: string, shot: BootstrapShotDraft, stageId: StageId): void {
  const dir = stageDir(episodeId, shot.id, stageId);
  // prompt.md — ровно текст для модели, на её языке. Доска его не сочиняет: пишет агент
  // по плейбуку модели или пользователь. Действие кадра лежит в shot.md.
  writeText(path.join(dir, "prompt.md"), "");
  writeText(
    path.join(dir, "llm_notes.md"),
    "",
  );
  writeText(path.join(dir, "refs.md"), defaultRefs(stageId, shot));
  writeText(path.join(dir, "workflow.md"), defaultWorkflow(stageId));
  writeStatusFile(episodeId, shot.id, stageId, {
    status: "prep",
    expectedCharacters:
      stageId === "characters" ? shot.characters : undefined,
  });
}

export function applyBootstrap(options: {
  scenario?: string;
  shotIds?: string[];
  overwriteDocs?: boolean;
  episodeId: string;
}): { created: string[]; updated: string[]; skipped: string[] } {
  const episodeKey = options.episodeId.trim();
  if (!episodeKey) throw new Error("Укажи имя эпизода, например e01");

  const scenario = options.scenario ?? readScenarioFile(episodeRoot(episodeKey));
  if (!scenario.trim()) {
    throw new Error("Размеченный сценарий пуст — нечего импортировать");
  }

  const preview = parseScenario(scenario);
  if (!preview.shots.length) {
    throw new Error(
      "В тексте нет кадров вида «## s01 Название». «Создать выбранные» — скрипт, он не вызывает агента и не размечает сырой сценарий. Вставь сырой текст в верхнее поле и нажми «Отправить на разметку».",
    );
  }

  const selected = new Set(
    (options.shotIds?.length ? options.shotIds : preview.shots.map((s) => s.id)).map(
      (id) => id.toLowerCase(),
    ),
  );
  const matched = preview.shots.filter((shot) => selected.has(shot.id.toLowerCase()));
  if (!matched.length) {
    throw new Error(
      "Ни один выбранный кадр не найден в тексте. Нажми «Предпросмотр» ещё раз. Снятая галка не удаляет кадр из таблицы, она только не даёт создать его сейчас.",
    );
  }

  const episodeId = createEpisode(episodeKey);
  const root = episodeRoot(episodeId);
  const scenarioPath = path.join(root, "scenario.md");
  writeText(scenarioPath, scenario.endsWith("\n") ? scenario : `${scenario}\n`);
  writeText(
    path.join(root, "episode.md"),
    `# ${preview.seriesTitle}\n\nЭпизод ${episodeId}.\n`,
  );

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  for (const shot of preview.shots) {
    if (!selected.has(shot.id.toLowerCase())) {
      skipped.push(shot.id);
      continue;
    }

    const shotPath = path.join(root, "shots", shot.id);
    const existed = fs.existsSync(shotPath);
    ensureStageDirs(episodeId, shot.id);

    const meta: ShotMeta = {
      id: shot.id,
      title: shot.title,
      summary: shot.summary,
      characters: shot.characters,
      location: shot.location,
    };
    writeShotMeta(episodeId, meta);
    seedShotSpeechAndDuration(episodeId, shot, options.overwriteDocs === true);
    // «Спиной» из разметки — только если в ней есть строка framing; иначе доска берёт это из текста кадра.
    const back = shot.framing ? (shot.backView ?? []) : undefined;
    seedFraming(episodeId, shot.id, shot.characters, shot.framing ?? {}, shot.summary, options.overwriteDocs === true, back);

    for (const stageId of STAGES) {
      const promptPath = path.join(stageDir(episodeId, shot.id, stageId), "prompt.md");
      const hasPrompt = fs.existsSync(promptPath) && fs.readFileSync(promptPath, "utf8").trim();
      if (!hasPrompt || options.overwriteDocs) {
        seedStageDocs(episodeId, shot, stageId);
      }
    }

    if (existed) updated.push(shot.id);
    else created.push(shot.id);
  }

  return { created, updated, skipped };
}

function readScenarioFile(root: string): string {
  const scenarioPath = path.join(root, "scenario.md");
  return fs.existsSync(scenarioPath) ? fs.readFileSync(scenarioPath, "utf8") : "";
}

export function readScenarioText(episodeId: string): string {
  return readScenarioFile(episodeRoot(episodeId));
}

export function readRawScenarioText(episodeId: string): string {
  const rawPath = path.join(episodeRoot(episodeId), "scenario_raw.md");
  return fs.existsSync(rawPath) ? fs.readFileSync(rawPath, "utf8") : "";
}
