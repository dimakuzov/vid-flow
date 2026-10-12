import fs from "fs";
import path from "path";
import { claudeOneShot, claudeOneShotAvailable } from "../agent/claude-oneshot";
import type { ApiPrompt, ComfyJob } from "../contracts/comfy-job";
import type { BindingSlot, GraphBinding } from "../contracts/graph-binding";
import type { StageId } from "../series/constants";
import {
  readImageEdits,
  recordImageEdit,
  reserveOutputName,
  writeImageEdits,
  type ImageEditRecord,
} from "../series/mutations";
import { getComfyQueueRoot, getPlaybooksRoot, stageDir, toPosix } from "../series/paths";
import { assertStageFree, writeStageState } from "../series/stage-state";
import { buildPrompt, comfyWorkflowsDir, validateBinding } from "./binding";
import { enqueueComfyJob, readComfyJob, startComfyQueue } from "./queue";

/** Haiku собирает промпт из текста, картинку не смотрит. Пустое поле до него не доходит. */
const EDIT_MODEL = "claude-haiku-5-5";

/**
 * Пустое поле: только текстуры и мелкие детали.
 * Объекты, свет и камера остаются. В граф уходит как есть, без Claude.
 */
export const QUALITY_PROMPT =
  "Edit image 1: slightly improve the textures and the fine detail only. The camera position, angle and framing must not change. Keep the same objects in the same places, nothing added, nothing removed, nothing moved, and the same light and colours.";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export interface EditWorkflow {
  id: string;
  label: string;
  description: string;
  /** `megapixels` ноды 13 в графе. Поле в окне начинает с этого числа. */
  megapixels: number;
}

function editDir(): string {
  return path.join(comfyWorkflowsDir(), "edit");
}

function relativeToCwd(absolute: string): string {
  return toPosix(path.relative(process.cwd(), absolute));
}

/**
 * Манифест из `playbooks/workflows/comfy/edit/`.
 * Эту папку `loadBindings` не читает: пункт меню этапа не появляется.
 */
function loadEditBinding(id: string): { binding: GraphBinding; graph: ApiPrompt } {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/.test(id)) throw new Error("Неизвестный воркфлоу правки");
  const file = path.join(editDir(), `${id}.bind.json`);
  if (!fs.existsSync(file)) throw new Error(`Нет воркфлоу правки ${id}`);
  const binding = JSON.parse(fs.readFileSync(file, "utf8")) as GraphBinding;
  const graphFile = path.resolve(path.dirname(file), String(binding.graph || ""));
  if (!fs.existsSync(graphFile)) throw new Error(`Нет графа ${binding.graph}`);
  const graph = JSON.parse(fs.readFileSync(graphFile, "utf8")) as ApiPrompt;
  validateBinding(binding, graph, id);
  return { binding, graph };
}

/** Воркфлоу окна «Править». Сломанный манифест в список не попадает. */
export function listEditWorkflows(): EditWorkflow[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(editDir()).filter((name) => name.endsWith(".bind.json")).sort();
  } catch {
    return [];
  }
  const workflows: EditWorkflow[] = [];
  for (const name of names) {
    const id = name.slice(0, -".bind.json".length);
    try {
      const loaded = loadEditBinding(id);
      workflows.push({
        id,
        label: loaded.binding.label,
        description: loaded.binding.description,
        megapixels: graphMegapixels(loaded.graph),
      });
    } catch {
      // Сломанный манифест не предлагаем. Ошибка всплывёт, если его всё же запросят по id.
    }
  }
  return workflows;
}

function playbookText(): string {
  return fs.readFileSync(path.join(getPlaybooksRoot(), "models", "image_edit.en.md"), "utf8");
}

/** Мегапиксели ноды 13. Нет числа в графе — то, что стоит в qwen21 сейчас. */
function graphMegapixels(graph: ApiPrompt): number {
  const value = graph["13"]?.inputs?.megapixels;
  return typeof value === "number" && value > 0 ? value : 2.3;
}

/**
 * Английский промпт без модели: сервер проверки не зовёт Claude
 * (`FRAMEBOARD_DESCRIBE=off` / `FRAMEBOARD_LOOPS=off` без подмены).
 * Просьба остаётся внутри шаблона, замок камеры — всегда.
 */
function fallbackPrompt(text: string): string {
  return `Edit image 1: ${text}. The camera position, angle and framing must not change. Keep everything the user did not ask to change exactly as it is.`;
}

/**
 * Пустой текст — готовое улучшение, модель не вызывается.
 * Иначе Haiku 5.5 собирает промпт по плейбуку и картинку не получает.
 */
export async function translateEditRequest(text: string, signal: AbortSignal): Promise<string> {
  const change = text.trim();
  if (!change) return QUALITY_PROMPT;
  if (!claudeOneShotAvailable()) return fallbackPrompt(change);
  const result = await claudeOneShot({
    prompt: [
      "Turn the user's change into one English edit prompt for an image model.",
      "You do not have the picture and must not ask to see it.",
      "The user's change comes first. Keeping the rest of the picture comes second.",
      "Always say the camera position, angle and framing must not change.",
      "Do not lock a part the user asked to change: if they change the light, do not say the light stays; if they add, remove or move an object, say the other objects stay and do not say nothing was added or removed.",
      "Reply with the prompt only: no title, no quotes, no markdown fence.",
      "",
      "Playbook:",
      playbookText(),
      "",
      "User's change:",
      change,
    ].join("\n"),
    model: EDIT_MODEL,
    signal,
  });
  const prompt = result.text.trim().replace(/^```[a-z]*\n?|```$/g, "").trim();
  if (!prompt) throw new Error("Агент не написал промпт правки");
  if (/[а-яё]/i.test(prompt)) {
    throw new Error("Промпт правки должен быть на английском. Отправьте ещё раз.");
  }
  if (/^edit image 1:/i.test(prompt)) return prompt;
  return fallbackPrompt(prompt);
}

function stageImage(episodeId: string, shotId: string, stageId: StageId, folder: string, filename: string): string {
  if (folder !== "output" && folder !== "approve") {
    throw new Error("Править можно файл из output/ или approve/");
  }
  const safeName = path.basename(filename);
  if (!safeName || safeName !== filename || safeName === "." || safeName === "..") {
    throw new Error("Некорректное имя файла");
  }
  if (!IMAGE_EXT.has(path.extname(safeName).toLowerCase())) {
    throw new Error("Править можно только картинку");
  }
  const source = path.join(stageDir(episodeId, shotId, stageId), folder, safeName);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`Файл не найден: ${safeName}`);
  }
  return source;
}

function writeSlot(prompt: ApiPrompt, slot: BindingSlot, value: unknown): void {
  for (const target of slot.targets) {
    if (target.json) throw new Error("Слот правки не пишет внутрь JSON");
    prompt[target.node].inputs[target.field] = value;
  }
}

/**
 * Собрать задание правки. `buildPrompt` снимает пустые входы и ставит seed.
 * Сам файл и текст правки манифест взять не может: источник картинки — один
 * выбранный файл, а текст — не prompt.md этапа. Их пишем в слоты манифеста после сборки.
 */
function assembleEditPrompt(
  binding: GraphBinding,
  graph: ApiPrompt,
  episodeId: string,
  shotId: string,
  stageId: StageId,
  source: string,
  english: string,
  savedAs: string,
  megapixels: number | undefined,
): { prompt: ApiPrompt; uploadName: string } {
  const built = buildPrompt(binding, graph, { episodeId, shotId, stageId });
  if (built.uploads.length) {
    throw new Error("Воркфлоу правки подхватил чужой файл. Манифест не должен брать картинки этапа.");
  }
  const uploadName = path.basename(source);
  const stem = path.parse(savedAs).name;
  for (const slot of binding.slots) {
    const value = slot.value;
    if ("input" in value && value.input === "source") writeSlot(built.prompt, slot, uploadName);
    if ("const" in value && slot.targets.some((target) => target.field === "value")) {
      writeSlot(built.prompt, slot, english);
    }
    if ("template" in value && slot.targets.some((target) => target.field === "filename_prefix")) {
      writeSlot(built.prompt, slot, `frameboard/edit/${stem}`);
    }
  }
  if (megapixels != null) {
    const node = built.prompt["13"];
    if (!node?.inputs) throw new Error("В графе нет ноды 13: мегапиксели некуда записать");
    node.inputs.megapixels = megapixels;
  }
  return { prompt: built.prompt, uploadName };
}

/** Число из поля. Пусто — оставить мегапиксели графа. */
export function parseEditMegapixels(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error("Мегапиксели: нужно число");
  const megapixels = Math.round(parsed * 100) / 100;
  if (megapixels < 0.1 || megapixels > 16) throw new Error("Мегапиксели: число от 0.1 до 16");
  return megapixels;
}

function jobsForStage(episodeId: string, shotId: string, stageId: StageId): ComfyJob[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(getComfyQueueRoot()).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const jobs: ComfyJob[] = [];
  for (const name of names) {
    try {
      const job = readComfyJob(name.slice(0, -".json".length));
      if (job && job.episodeId === episodeId && job.shotId === shotId && job.stageId === stageId) jobs.push(job);
    } catch {
      // Файл ещё пишется или id чужой.
    }
  }
  return jobs;
}

/**
 * Если очередь сохранила результат под именем ComfyUI, подпись на карточке
 * смотрит на этот файл. Запись без файла на диске обновляется, готовые не трогаются.
 */
export function syncEditFiles(episodeId: string, shotId: string, stageId: StageId): ImageEditRecord[] {
  const edits = readImageEdits(episodeId, shotId, stageId);
  const outputDir = path.join(stageDir(episodeId, shotId, stageId), "output");
  const workflowIds = new Set(listEditWorkflows().map((item) => item.id));
  let changed = false;
  for (const job of jobsForStage(episodeId, shotId, stageId)) {
    if (job.status !== "done" || !job.workflow || !workflowIds.has(job.workflow)) continue;
    const fromName = path.basename(job.uploads?.[0]?.filename || job.uploads?.[0]?.path || "");
    for (const saved of job.files || []) {
      if (edits.some((item) => item.file === saved)) continue;
      if (!fs.existsSync(path.join(outputDir, saved))) continue;
      const pending = edits.find(
        (item) =>
          item.kind === "edit" &&
          item.workflow === job.workflow &&
          item.from === fromName &&
          !fs.existsSync(path.join(outputDir, item.file)),
      );
      if (!pending) continue;
      pending.file = saved;
      changed = true;
    }
  }
  if (changed) writeImageEdits(episodeId, shotId, stageId, edits);
  return edits;
}

/**
 * Поставить правку картинки в очередь ComfyUI. Исходник не меняется.
 * Новый файл ожидается в output/ как `{имя}_edit_v1.png` (при совпадении — суффикс).
 */
export async function queueImageEdit(options: {
  episodeId: string;
  shotId: string;
  stageId: StageId;
  folder: "output" | "approve";
  filename: string;
  workflowId: string;
  text: string;
  /** Нет числа — в ноде 13 остаётся значение графа. */
  megapixels?: number;
  signal: AbortSignal;
}): Promise<{ id: string; savedAs: string; prompt: string; message: string }> {
  assertStageFree(options.episodeId, options.shotId, options.stageId);
  const source = stageImage(
    options.episodeId,
    options.shotId,
    options.stageId,
    options.folder,
    options.filename,
  );
  const before = fs.readFileSync(source);
  const english = await translateEditRequest(options.text, options.signal);
  const { binding, graph } = loadEditBinding(options.workflowId);
  const stem = path.parse(path.basename(source)).name;
  const savedAs = reserveOutputName(options.episodeId, options.shotId, options.stageId, `${stem}_edit_v1.png`);
  const assembled = assembleEditPrompt(
    binding,
    graph,
    options.episodeId,
    options.shotId,
    options.stageId,
    source,
    english,
    savedAs,
    options.megapixels,
  );
  if (!fs.readFileSync(source).equals(before)) {
    throw new Error("Исходный файл изменился во время сборки задания");
  }
  const job = enqueueComfyJob({
    id: `${options.shotId}-edit-${binding.id}-${Date.now()}`,
    status: "pending",
    episodeId: options.episodeId,
    shotId: options.shotId,
    stageId: options.stageId,
    workflow: binding.id,
    prompt: assembled.prompt,
    uploads: [{ path: relativeToCwd(source), filename: assembled.uploadName }],
    saveTo: relativeToCwd(path.join(stageDir(options.episodeId, options.shotId, options.stageId), "output")),
  });
  recordImageEdit(options.episodeId, options.shotId, options.stageId, {
    file: savedAs,
    from: path.basename(source),
    kind: "edit",
    prompt: english,
    workflow: binding.id,
    at: new Date().toISOString(),
  });
  writeStageState(options.episodeId, options.shotId, options.stageId, { phase: "comfy", jobId: job.id });
  startComfyQueue();
  return {
    id: job.id,
    savedAs,
    prompt: english,
    message: `В очереди Comfy: ${job.id}. Прогон идёт там, файл появится в output/.`,
  };
}
