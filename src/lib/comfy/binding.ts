import fs from "fs";
import path from "path";
import type { ApiPrompt } from "../contracts/comfy-job";
import type {
  BindingInput,
  BindingSlot,
  GraphBinding,
  ImageInput,
  ImageSource,
  NumberInput,
  TextStep,
  TextTemplate,
} from "../contracts/graph-binding";
import { STAGES, type StageId } from "../series/constants";
import { readTextIfExists } from "../series/media";
import { getLocationsRoot, getPlaybooksRoot, stageDir } from "../series/paths";
import { readShotMeta } from "../series/shot-meta";

/*
 * Манифесты графов (docs/contracts/graph-binding.md): загрузка, проверка против графа,
 * сборка prompt «манифест + граф + значения входов». Код не знает node id.
 */

const FORMAT = "frameboard.graph-binding/1";
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function comfyWorkflowsDir(): string {
  return path.join(getPlaybooksRoot(), "workflows", "comfy");
}

// ---------- загрузка и проверка ----------

export interface LoadedBinding {
  /** id из имени файла: манифест с ошибкой тоже виден в меню. */
  id: string;
  file: string;
  binding: GraphBinding | null;
  graph: ApiPrompt | null;
  /** Почему манифест нельзя запустить. */
  error: string | null;
}

const cache = new Map<string, { key: string; loaded: LoadedBinding }>();

function mtimeKey(...files: string[]): string {
  return files
    .map((file) => {
      try {
        return String(fs.statSync(file).mtimeMs);
      } catch {
        return "-";
      }
    })
    .join("|");
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Проверяет манифест против графа. Бросает ошибку с именами манифеста, ноды и графа. */
export function validateBinding(binding: GraphBinding, graph: ApiPrompt, expectedId?: string): void {
  const where = `манифест ${binding.id || expectedId}`;
  const fail = (message: string): never => {
    throw new Error(`${where}: ${message}`);
  };
  if (binding.format !== FORMAT) fail(`format должен быть ${FORMAT}`);
  if (expectedId && binding.id !== expectedId) fail(`id «${binding.id}» не совпадает с именем файла ${expectedId}.bind.json`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/.test(binding.id)) fail("id: латиница, цифры, _ и -");
  if (!STAGES.includes(binding.stage)) fail(`неизвестный этап ${binding.stage}`);
  if (typeof binding.order !== "number") fail("нет order");
  for (const [id, node] of Object.entries(graph)) {
    if (!node || typeof node.class_type !== "string" || !node.inputs || typeof node.inputs !== "object") {
      fail(`граф ${binding.graph}: нода ${id} не в формате API`);
    }
  }

  const inputs = binding.inputs || {};
  for (const [name, input] of Object.entries(inputs)) {
    if (input.kind === "image") {
      const sources = Array.isArray(input.from) ? input.from : [input.from];
      if (!sources.length) fail(`вход ${name}: пустой from`);
      for (const source of sources) {
        const stage = source.startsWith("approve:") ? source.slice("approve:".length) : null;
        const known = source === "refs" || source === "library:location" || (stage && STAGES.includes(stage as StageId));
        if (!known) fail(`вход ${name}: неизвестный источник ${source}`);
      }
      if (!["first", "newest", "all"].includes(input.pick)) fail(`вход ${name}: pick ${input.pick}`);
    } else if (input.kind === "text") {
      if (input.from !== "prompt") fail(`вход ${name}: текст берётся только из prompt`);
    } else if (input.kind === "number") {
      if (input.from !== "prompt:seconds") fail(`вход ${name}: число берётся только из prompt:seconds`);
    } else {
      fail(`вход ${name}: неизвестный kind ${(input as { kind: string }).kind}`);
    }
  }

  const nodeRef = (node: string, field: string | undefined, what: string) => {
    const target = graph[node];
    if (!target) fail(`${what}: ноды ${node} нет в графе ${binding.graph}`);
    if (field !== undefined && !(field in target.inputs)) {
      fail(`${what}: у ноды ${node} (${target.class_type}) нет поля ${field} в графе ${binding.graph}`);
    }
  };

  (binding.slots || []).forEach((slot, index) => {
    const what = `слот ${index + 1}`;
    if (!slot.targets?.length) fail(`${what}: нет targets`);
    for (const target of slot.targets) nodeRef(target.node, target.field, what);
    for (const removal of slot.whenEmpty?.remove ?? []) nodeRef(removal.node, removal.field, `${what}, whenEmpty`);
    const value = slot.value as Record<string, unknown>;
    if (typeof value.input === "string") {
      const input = inputs[value.input];
      if (!input) fail(`${what}: неизвестный вход ${value.input}`);
      if ((value.steps || value.templates) && input.kind !== "text") fail(`${what}: steps и templates только для текста`);
      if (value.index !== undefined && input.kind !== "image") fail(`${what}: index только для картинки`);
      for (const step of (value.steps as TextStep[] | undefined) ?? []) {
        if ("ensure" in step && step.unless !== undefined) {
          // В JSON "\b" — это символ backspace, а не граница слова: нужно "\\b".
          if (/[\u0000-\u001f]/.test(step.unless)) {
            fail(`${what}: в unless управляющий символ (в JSON граница слова пишется "\\\\b")`);
          }
          try {
            new RegExp(step.unless, "i");
          } catch (error) {
            fail(`${what}: unless не регэксп: ${(error as Error).message}`);
          }
        }
      }
      for (const template of (value.templates as TextTemplate[] | undefined) ?? []) {
        if (template.when && inputs[template.when.input]?.kind !== "image") {
          fail(`${what}: when.input ${template.when.input} — не картинка`);
        }
      }
    } else if (value.seed !== "random" && typeof value.template !== "string") {
      fail(`${what}: значение должно быть input, seed или template`);
    }
  });
}

function loadOne(file: string): LoadedBinding {
  const id = path.basename(file).slice(0, -".bind.json".length);
  let binding: GraphBinding | null = null;
  try {
    binding = readJson(file) as GraphBinding;
  } catch (error) {
    return { id, file, binding: null, graph: null, error: `манифест ${id}: не JSON (${(error as Error).message})` };
  }
  const graphFile = path.join(path.dirname(file), String(binding.graph || ""));
  const key = mtimeKey(file, graphFile);
  const cached = cache.get(file);
  if (cached && cached.key === key) return cached.loaded;
  let loaded: LoadedBinding;
  try {
    if (!binding.graph || !fs.existsSync(graphFile)) throw new Error(`манифест ${id}: нет графа ${binding.graph}`);
    let graph: ApiPrompt;
    try {
      graph = readJson(graphFile) as ApiPrompt;
    } catch (error) {
      throw new Error(`манифест ${id}: граф ${binding.graph} не JSON (${(error as Error).message})`);
    }
    validateBinding(binding, graph, id);
    loaded = { id, file, binding, graph, error: null };
  } catch (error) {
    loaded = { id, file, binding, graph: null, error: (error as Error).message };
  }
  cache.set(file, { key, loaded });
  return loaded;
}

/** Все манифесты `playbooks/workflows/comfy/*.bind.json`, включая сломанные (с `error`). */
export function loadBindings(): LoadedBinding[] {
  const dir = comfyWorkflowsDir();
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith(".bind.json")).sort();
  } catch {
    return [];
  }
  return names.map((name) => loadOne(path.join(dir, name)));
}

/** Манифесты этапа по order. У сломанного манифеста stage берётся из его JSON, если он читается. */
export function stageBindings(stageId: StageId): LoadedBinding[] {
  return loadBindings()
    .filter((item) => item.binding?.stage === stageId)
    .sort((a, b) => (a.binding?.order ?? 0) - (b.binding?.order ?? 0));
}

// ---------- входы ----------

export interface ShotContext {
  episodeId: string;
  shotId: string;
  stageId: StageId;
}

function listImages(dir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => IMAGE_EXT.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => path.join(dir, name));
}

function libraryLocation(locationId: string): string[] {
  const root = getLocationsRoot();
  if (!locationId) return [];
  let folderName: string | undefined;
  try {
    folderName = fs.readdirSync(root).find((name) => name.toLowerCase() === locationId.toLowerCase());
  } catch {
    return [];
  }
  if (!folderName) return [];
  const folder = path.join(root, folderName);
  const view = path.join(folder, "view.png");
  if (fs.existsSync(view)) return [view];
  return listImages(folder).filter((file) => !/copy/i.test(path.basename(file)));
}

function sourceImages(ctx: ShotContext, source: ImageSource): string[] {
  if (source === "refs") return listImages(path.join(stageDir(ctx.episodeId, ctx.shotId, ctx.stageId), "refs"));
  if (source === "library:location") return libraryLocation(readShotMeta(ctx.episodeId, ctx.shotId).location);
  const stage = source.slice("approve:".length) as StageId;
  return listImages(path.join(stageDir(ctx.episodeId, ctx.shotId, stage), "approve"));
}

function pickImages(files: string[], input: ImageInput): string[] {
  if (!files.length) return [];
  if (input.pick === "first") return [files[0]];
  if (input.pick === "newest") {
    const newest = files
      .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0].file;
    return [newest];
  }
  return input.max != null ? files.slice(0, input.max) : files;
}

/** Картинки входа: первый непустой источник, затем pick. */
export function resolveImageInput(ctx: ShotContext, input: ImageInput): string[] {
  const sources = Array.isArray(input.from) ? input.from : [input.from];
  for (const source of sources) {
    const files = sourceImages(ctx, source);
    if (files.length) return pickImages(files, input);
  }
  return [];
}

function imageMin(input: ImageInput): number {
  return input.min ?? 1;
}

/** Подписи обязательных входов-картинок, которых не хватает. Текст и число на доступность не влияют. */
export function missingInputs(ctx: ShotContext, binding: GraphBinding): string[] {
  const missing: string[] = [];
  for (const input of Object.values(binding.inputs)) {
    if (input.kind !== "image" || imageMin(input) < 1) continue;
    if (resolveImageInput(ctx, input).length < imageMin(input)) missing.push(input.label);
  }
  return missing;
}

/** Строки инструкции доски из старых prompt.md («Собери shot-вариант…»). */
const BOARD_INSTRUCTION = /^\s*(Собери |Правила:\s*playbooks\/|Локация:|Персонажи:)/m;

export function assertModelText(text: string): void {
  if (BOARD_INSTRUCTION.test(text)) {
    throw new Error(
      "prompt.md содержит инструкцию для агента, а не текст для модели: перепиши его или отправь агенту.",
    );
  }
}

/** Секунды из текста: «5 сек», «5s», «5 с». Вне min..max — нет значения. */
export function secondsInText(text: string, input: NumberInput): number | null {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(?:секунд\w*|сек\.?|sec\b|s\b|с(?=\s|$|[.,]))/i);
  if (!match) return null;
  const seconds = Number(match[1].replace(",", "."));
  if (!Number.isFinite(seconds)) return null;
  if (input.min != null && seconds < input.min) return null;
  if (input.max != null && seconds > input.max) return null;
  return seconds;
}

// ---------- текст ----------

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applySteps(text: string, steps: TextStep[], characters: string[]): string {
  let next = text;
  for (const step of steps) {
    if ("namesTo" in step) {
      for (const name of [...characters].filter(Boolean).sort((a, b) => b.length - a.length)) {
        // Граница слова с учётом кириллицы: \b в JS знает только латиницу.
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`, "giu");
        next = next.replace(pattern, step.namesTo);
      }
      next = next.replace(/[ \t]{2,}/g, " ").trim();
      continue;
    }
    if (step.unless && new RegExp(step.unless, "i").test(next)) continue;
    if (!next) next = step.ensure;
    else next = step.at === "start" ? `${step.ensure}${step.separator}${next}` : `${next}${step.separator}${step.ensure}`;
  }
  return next;
}

function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key] : whole));
}

/** Шаблон: строка, где были только плейсхолдеры и после подстановки пусто, удаляется. */
export function renderTemplate(template: string, values: Record<string, string>): string {
  const lines: string[] = [];
  for (const line of template.split("\n")) {
    const filled = fillPlaceholders(line, values);
    const onlyPlaceholders = line.trim() !== "" && line.replace(/\{\w+\}/g, "").trim() === "";
    if (onlyPlaceholders && filled.trim() === "") continue;
    lines.push(filled);
  }
  return lines.join("\n");
}

function pickTemplate(templates: TextTemplate[], counts: Record<string, number>): TextTemplate | null {
  for (const template of templates) {
    const when = template.when;
    if (!when) return template;
    const count = counts[when.input] ?? 0;
    if (when.countAtLeast != null && count < when.countAtLeast) continue;
    if (when.countAtMost != null && count > when.countAtMost) continue;
    return template;
  }
  return null;
}

// ---------- сборка ----------

export interface BuiltPrompt {
  prompt: ApiPrompt;
  uploads: { path: string; filename: string }[];
}

export interface BuildContext extends ShotContext {
  /** Случайное число для seed: подменяется в тестах. */
  random?: () => number;
}

function newSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000_000_000);
}

function uploadName(input: ImageInput, file: string, index: number, ctx: ShotContext): string {
  if (!input.uploadAs) return path.basename(file);
  return fillPlaceholders(input.uploadAs, {
    shotId: ctx.shotId,
    episodeId: ctx.episodeId,
    index: String(index),
    ext: path.extname(file).toLowerCase() || ".png",
  });
}

/**
 * prompt для ComfyUI из манифеста, графа и папок кадра. Пути uploads — абсолютные.
 * Ошибки: нет обязательного входа, пустой обязательный prompt.md, инструкция доски в prompt.md.
 */
export function buildPrompt(binding: GraphBinding, graph: ApiPrompt, ctx: BuildContext): BuiltPrompt {
  const prompt = structuredClone(graph);
  const seed = ctx.random ?? newSeed;
  const meta = readShotMeta(ctx.episodeId, ctx.shotId);
  const promptMd = readTextIfExists(path.join(stageDir(ctx.episodeId, ctx.shotId, ctx.stageId), "prompt.md")).trim();

  const images: Record<string, string[]> = {};
  const missing: string[] = [];
  for (const [name, input] of Object.entries(binding.inputs)) {
    if (input.kind === "image") {
      images[name] = resolveImageInput(ctx, input);
      if (images[name].length < imageMin(input)) missing.push(input.label);
    } else if (input.kind === "text") {
      if (input.required && !promptMd) {
        throw new Error("В prompt.md нет текста для модели. Отправь рекомендацию агенту или впиши промпт сам.");
      }
      assertModelText(promptMd);
    }
  }
  if (missing.length) throw new Error(`Для «${binding.label}» не хватает: ${missing.join(", ")}.`);
  const counts = Object.fromEntries(Object.entries(images).map(([name, files]) => [name, files.length]));

  const uploads: BuiltPrompt["uploads"] = [];
  const removals: Array<{ node: string; field?: string }> = [];
  const write = (slot: BindingSlot, value: unknown) => {
    for (const target of slot.targets) prompt[target.node].inputs[target.field] = value;
  };
  /** Значения нет: whenEmpty, иначе ошибка для обязательного входа, иначе значение графа. */
  const empty = (slot: BindingSlot, input: BindingInput, required: boolean) => {
    if (slot.whenEmpty) removals.push(...slot.whenEmpty.remove);
    else if (required) throw new Error(`Для «${binding.label}» не хватает: ${input.label}.`);
  };

  for (const slot of binding.slots) {
    const value = slot.value;
    if ("seed" in value) {
      for (const target of slot.targets) prompt[target.node].inputs[target.field] = seed();
      continue;
    }
    if ("template" in value) {
      write(
        slot,
        fillPlaceholders(value.template, {
          shotId: ctx.shotId,
          episodeId: ctx.episodeId,
          stageId: ctx.stageId,
          workflow: binding.id,
        }),
      );
      continue;
    }
    const input = binding.inputs[value.input];
    if (input.kind === "image") {
      const index = "index" in value && value.index != null ? value.index : 0;
      const file = images[value.input][index];
      if (!file) {
        empty(slot, input, imageMin(input) >= 1);
        continue;
      }
      const filename = uploadName(input, file, index, ctx);
      if (!uploads.some((item) => item.path === file && item.filename === filename)) uploads.push({ path: file, filename });
      write(slot, filename);
    } else if (input.kind === "text") {
      const steps = "steps" in value ? value.steps : undefined;
      const templates = "templates" in value ? value.templates : undefined;
      let text = steps?.length ? applySteps(promptMd, steps, meta.characters) : promptMd;
      const template = templates?.length ? pickTemplate(templates, counts) : null;
      if (template) {
        text = renderTemplate(template.text, { text, shotId: ctx.shotId, episodeId: ctx.episodeId });
      }
      if (!text.trim()) empty(slot, input, input.required);
      else write(slot, text);
    } else {
      const seconds = secondsInText(promptMd, input);
      if (seconds == null) empty(slot, input, false);
      else write(slot, seconds);
    }
  }

  for (const removal of removals) {
    if (removal.field === undefined) delete prompt[removal.node];
    else if (prompt[removal.node]) delete prompt[removal.node].inputs[removal.field];
  }
  return { prompt, uploads };
}
