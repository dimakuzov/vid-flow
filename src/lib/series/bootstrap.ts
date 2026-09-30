import fs from "fs";
import path from "path";
import { STAGES, type StageId } from "./constants";
import { writeText } from "./media";
import {
  ensureSeriesScaffold,
  ensureStageDirs,
  getSeriesRoot,
  stageDir,
} from "./paths";
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
      return `Собери shot-вариант персонажей для ${shot.id} (${shot.title}).\nПерсонажи: ${shot.characters.join(", ") || "уточнить"}.\nВнешность берётся из data/series/characters/{name}/ (portrait, side, full_body).\nВ этом кадре задай одежду и позу. В промпте не описывай внешность и одежду текстом.\nПравила: playbooks/stages/characters.md`;
    case "location":
      return `Собери shot-вариант локации без персонажей для ${shot.id}.\nЛокация: ${shot.location || "уточнить"}.\nОбщий вид: data/series/locations/${shot.location || "{locationId}"}/.\nПравила: playbooks/stages/location.md`;
    case "first_frame":
      return `Собери первый кадр: объедини approved локацию и персонажей для ${shot.id}.\nДействие: ${shot.summary || shot.title}`;
    case "video_preview":
      return `Сгенерируй preview-видео низкого разрешения для ${shot.id}.\nПроверь движение и развитие кадра.\nДействие: ${shot.summary || shot.title}`;
    case "final_render":
      return `Финальный рендер высокого разрешения для ${shot.id} на основе approved preview.`;
  }
}

function defaultRefs(stageId: StageId, shot: BootstrapShotDraft): string {
  if (stageId === "characters") {
    const names = shot.characters.length ? shot.characters.join(", ") : "{name}";
    return `# Refs\n\nБаза: data/series/characters/{name}/ — portrait.png, side.png, full_body.png.\nПерсонажи кадра: ${names}.\nВ refs/ этого кадра: {name}_outfit.png, {name}_pose.png, {name}_face.png.\nСм. playbooks/stages/characters.md.\n`;
  }
  if (stageId === "location") {
    const location = shot.location || "{locationId}";
    return `# Refs\n\nБаза: data/series/locations/${location}/.\nСюда кладётся общий вид. Shot-вариант уходит в output/ и approve/.\nСм. playbooks/stages/location.md.\n`;
  }
  return `# Refs\n\nОпиши, какие файлы из refs/ используются и зачем.\n`;
}

function defaultWorkflow(stageId: StageId): string {
  const note = `# Workflow\n\nНеобязательная заметка на этот кадр. Можно оставить пустым.\n\nЕсли нужно, запиши чем прогон отличается от болванки графа. Сам граф здесь не выбирается.\n`;
  if (stageId === "characters") {
    return `# Workflow\n\nНеобязательная заметка на этот кадр. Можно оставить пустым.\n\nЕсли нужно, запиши чем прогон отличается от болванки графа: поза, кадрирование, какие входы взяты. Сам граф здесь не выбирается.\n\nБолванка: playbooks/workflows/comfy/character_pose_outfit_qwen.json\n`;
  }
  return note;
}

function seedStageDocs(shot: BootstrapShotDraft, stageId: StageId): void {
  const dir = stageDir(shot.id, stageId);
  writeText(path.join(dir, "prompt.md"), defaultPrompt(stageId, shot) + "\n");
  writeText(
    path.join(dir, "llm_notes.md"),
    "Рекомендации агента появятся здесь после подготовки этапа.\n",
  );
  writeText(path.join(dir, "refs.md"), defaultRefs(stageId, shot));
  writeText(path.join(dir, "workflow.md"), defaultWorkflow(stageId));
  writeStatusFile(shot.id, stageId, {
    status: "prep",
    expectedCharacters:
      stageId === "characters" ? shot.characters : undefined,
  });
}

export function applyBootstrap(options: {
  scenario?: string;
  shotIds?: string[];
  overwriteDocs?: boolean;
}): { created: string[]; updated: string[]; skipped: string[] } {
  const root = getSeriesRoot();
  ensureSeriesScaffold(root);

  const scenarioPath = path.join(root, "scenario.md");
  const scenario =
    options.scenario ??
    (fs.existsSync(scenarioPath) ? fs.readFileSync(scenarioPath, "utf8") : "");
  if (!scenario.trim()) {
    throw new Error("scenario.md пуст — нечего импортировать");
  }

  if (options.scenario) {
    writeText(scenarioPath, options.scenario);
  }

  const preview = parseScenario(scenario);
  writeText(
    path.join(root, "series.md"),
    `# ${preview.seriesTitle}\n\nСерия кадров для локальной генерации видео.\n`,
  );

  const selected = new Set(
    (options.shotIds?.length ? options.shotIds : preview.shots.map((s) => s.id)).map(
      (id) => id.toLowerCase(),
    ),
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
    ensureStageDirs(shot.id, root);

    const meta: ShotMeta = {
      id: shot.id,
      title: shot.title,
      summary: shot.summary,
      characters: shot.characters,
      location: shot.location,
    };
    writeShotMeta(meta);

    for (const stageId of STAGES) {
      const promptPath = path.join(stageDir(shot.id, stageId), "prompt.md");
      const hasPrompt = fs.existsSync(promptPath) && fs.readFileSync(promptPath, "utf8").trim();
      if (!hasPrompt || options.overwriteDocs) {
        seedStageDocs(shot, stageId);
      }
    }

    if (existed) updated.push(shot.id);
    else created.push(shot.id);
  }

  return { created, updated, skipped };
}

export function readScenarioText(): string {
  const scenarioPath = path.join(getSeriesRoot(), "scenario.md");
  return fs.existsSync(scenarioPath) ? fs.readFileSync(scenarioPath, "utf8") : "";
}
