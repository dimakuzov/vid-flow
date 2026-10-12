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

/** Sonnet: правка — одно изменение, его надо сформулировать точно. */
const EDIT_MODEL = "claude-sonnet-5-5";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export interface EditWorkflow {
  id: string;
  label: string;
  description: string;
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
      const { binding } = loadEditBinding(id);
      workflows.push({ id, label: binding.label, description: binding.description });
    } catch {
      // Сломанный манифест не предлагаем. Ошибка всплывёт, если его всё же запросят по id.
    }
  }
  return workflows;
}

function playbookText(): string {
  return fs.readFileSync(path.join(getPlaybooksRoot(), "models", "image_edit.en.md"), "utf8");
}

/**
 * Английский промпт правки без модели: сервер проверки не зовёт Claude
 * (`FRAMEBOARD_DESCRIBE=off` / `FRAMEBOARD_LOOPS=off` без подмены).
 * Текст пользователя остаётся внутри шаблона.
 */
function fallbackPrompt(text: string): string {
  return `Edit image 1: ${text}. Keep EVERYTHING else exactly the same: the same camera position, angle and framing, the same objects in the same places, nothing added, nothing removed, nothing moved, the same light and colours.`;
}

/** Русский запрос → одна английская строка правки. Модель — Sonnet, плейбук image_edit. */
export async function translateEditRequest(text: string, signal: AbortSignal): Promise<string> {
  const change = text.trim();
  if (!change) throw new Error("Напишите, что изменить");
  if (!claudeOneShotAvailable()) return fallbackPrompt(change);
  const result = await claudeOneShot({
    prompt: [
      "Turn the user's change into one English edit prompt for an image model.",
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
  return { prompt: built.prompt, uploadName };
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
