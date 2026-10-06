import fs from "fs";
import path from "path";
import { STAGES, type StageId } from "./constants";
import { writeText } from "./media";
import { createEpisode, ensureStageDirs, episodeRoot, stageDir } from "./paths";
import { writeShotMeta, type ShotMeta } from "./shot-meta";
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

function defaultPrompt(stageId: StageId, shot: BootstrapShotDraft): string {
  switch (stageId) {
    case "characters":
      return `Собери shot-вариант персонажей для ${shot.id} (${shot.title}).\nПерсонажи: ${shot.characters.join(", ") || "уточнить"}.\nВнешность берётся из data/characters/{name}/ (portrait, side, full_body; если имени нет — существующий png этой папки).\nПо умолчанию меняется только одежда. Скелет и сборка позы не нужны, пока в задании прямо не сказано взять конкретную позу с референса.\nПрогон, не останавливаясь на тексте: playbooks/workflows/characters_comfy.md, раздел «Команда».\nПравила: playbooks/stages/characters.md`;
    case "location":
      return `Собери shot-вариант локации без персонажей для ${shot.id}.\nЛокация: ${shot.location || "уточнить"}.\nОбщий вид: data/locations/${shot.location || "{locationId}"}/.\nПравила: playbooks/stages/location.md`;
    case "first_frame":
      if (!shot.characters.length && !shot.location.trim()) {
        return `Собери первый кадр ${shot.id} сразу. Персонажей и локации в кадре нет, предыдущие этапы не делать.\nДействие: ${shot.summary || shot.title}`;
      }
      return `Собери первый кадр для ${shot.id}.\nУтверждённые персонажи и локация, если они уже есть, входят в кадр. Если их нет, не жди предыдущие этапы и собери кадр по действию.\nДействие: ${shot.summary || shot.title}`;
    case "video_preview":
      return `Сгенерируй preview-видео низкого разрешения для ${shot.id}.\nПроверь движение и развитие кадра.\nДействие: ${shot.summary || shot.title}`;
    case "final_render":
      return `Финальный рендер высокого разрешения для ${shot.id} на основе approved preview.`;
  }
}

function defaultRefs(stageId: StageId, shot: BootstrapShotDraft): string {
  if (stageId === "characters") {
    const names = shot.characters.length ? shot.characters.join(", ") : "{name}";
    return `# Refs\n\nБаза: data/characters/{name}/ — portrait.png, side.png, full_body.png.\nПерсонажи кадра: ${names}.\nВ refs/ этого кадра: {name}_outfit.png, {name}_pose.png, {name}_face.png.\nСм. playbooks/stages/characters.md.\n`;
  }
  if (stageId === "location") {
    const location = shot.location || "{locationId}";
    return `# Refs\n\nБаза: data/locations/${location}/view.png и description.txt.\nВ refs/ этого кадра: общий вид и, если нужен чужой ракурс, angle.png.\nShot-вариант уходит в output/ и approve/.\nСм. playbooks/stages/location.md.\n`;
  }
  if (stageId === "first_frame") {
    if (!shot.characters.length && !shot.location.trim()) {
      return `# Refs\n\nПерсонажей и локации нет. Предыдущие этапы не нужны.\nФайлы для кадра клади в refs/ этого этапа.\nСм. playbooks/stages/first_frame.md, раздел «Без персонажа и локации».\n`;
    }
    const names = shot.characters.length ? shot.characters.join(", ") : "{name}";
    return `# Refs\n\nЕсли персонажи и локация уже утверждены: локация из shots/${shot.id}/location/approve/, персонажи ${names} из shots/${shot.id}/characters/approve/{name}_${shot.id}.png.\nЕсли их нет, не жди эти этапы. Файлы кадра клади в refs/ здесь.\nСм. playbooks/stages/first_frame.md.\n`;
  }
  return `# Refs\n\nОпиши, какие файлы из refs/ используются и зачем.\n`;
}

function defaultWorkflow(stageId: StageId): string {
  const note = `# Workflow\n\nНеобязательная заметка на этот кадр. Можно оставить пустым.\n\nЕсли нужно, запиши чем прогон отличается от болванки графа. Сам граф здесь не выбирается.\n`;
  if (stageId === "characters") {
    return `# Workflow\n\nНеобязательная заметка на этот кадр. Можно оставить пустым.\n\nПо умолчанию одежду меняет отдельный edit. Скелет не снимается. Команда: playbooks/workflows/characters_comfy.md, раздел «Команда». Сам JSON графа не редактируется.\n\nГраф со скелетом playbooks/workflows/comfy/character_pose_outfit_qwen.json запускать только если в задании прямо сказано взять конкретную позу с референса.\n`;
  }
  if (stageId === "location") {
    return `# Workflow\n\nНеобязательная заметка на этот кадр. Можно оставить пустым.\n\nЕсли нужно, запиши чем прогон отличается от болванки графа: какой ракурс, какая ветка промпта. Сам граф здесь не выбирается.\n\nБолванка: playbooks/workflows/comfy/location_views_multiple_angles.json\n`;
  }
  if (stageId === "first_frame") {
    return `# Workflow\n\nНеобязательная заметка на этот кадр. Можно оставить пустым.\n\nЕсли нужно, запиши чем прогон отличается от болванки графа: режим сборки или правки, сколько персонажей. Сам граф здесь не выбирается.\n\nБолванка: playbooks/workflows/comfy/qwen21_character_compositing.json\n`;
  }
  return note;
}

function seedStageDocs(episodeId: string, shot: BootstrapShotDraft, stageId: StageId): void {
  const dir = stageDir(episodeId, shot.id, stageId);
  writeText(path.join(dir, "prompt.md"), defaultPrompt(stageId, shot) + "\n");
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
