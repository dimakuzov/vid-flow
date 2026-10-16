import fs from "fs";
import path from "path";
import type { ApiPrompt } from "../contracts/comfy-job";
import { appendRunLog } from "../agent/files";
import type {
  BindingInput,
  BindingSlot,
  DurationRange,
  GraphBinding,
  ImageInput,
  ImageSource,
  NodeTarget,
  NumberInput,
  PromptNodeRef,
  Removal,
  TextInput,
  TextStep,
  TextTemplate,
} from "../contracts/graph-binding";
import { characterBaseImage, characterClothingFiles, characterFolder } from "../series/character-base";
import { STAGES, type StageId } from "../series/constants";
import { mediaUrlPath, readTextIfExists } from "../series/media";
import { getCharactersRoot, getLocationsRoot, getPlaybooksRoot, stageDir } from "../series/paths";
import { chosenCharacterFile, excludedFiles, readRunSettings } from "../series/run-settings";
import { readShotMeta } from "../series/shot-meta";
import { readShotSpeech, speechPhrases } from "../series/speech";

/*
 * Манифесты графов (docs/contracts/graph-binding.md): загрузка, проверка против графа,
 * сборка prompt «манифест + граф + значения входов». Код не знает node id.
 */

const FORMAT = "frameboard.graph-binding/1";
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".mkv"]);
const SECTION_NAME = /^[a-z0-9_]+$/;

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
  if (binding.defaultWhen !== undefined && !["speech", "dialogue", "silent"].includes(binding.defaultWhen)) {
    fail(`defaultWhen: speech, dialogue или silent (сейчас ${binding.defaultWhen})`);
  }
  if (binding.forEach !== undefined && binding.forEach !== "character") {
    fail(`forEach: только character (сейчас ${binding.forEach})`);
  }
  if (binding.target !== undefined && binding.target !== "cloud") fail(`target: только cloud (сейчас ${binding.target})`);
  if (binding.target === "cloud") {
    const cost = binding.cost;
    if (!cost || !(cost.credits > 0) || !(cost.perSeconds > 0)) fail("target cloud: нужна цена cost { credits, perSeconds }");
  }
  for (const [id, node] of Object.entries(graph)) {
    if (!node || typeof node.class_type !== "string" || !node.inputs || typeof node.inputs !== "object") {
      fail(`граф ${binding.graph}: нода ${id} не в формате API`);
    }
  }

  const inputs = binding.inputs || {};
  for (const [name, input] of Object.entries(inputs)) {
    if (input.kind === "image" || input.kind === "video") {
      const sources = Array.isArray(input.from) ? input.from : [input.from];
      if (!sources.length) fail(`вход ${name}: пустой from`);
      for (const source of sources) {
        const stage = source.startsWith("approve:") ? source.slice("approve:".length) : null;
        const known =
          source === "refs" ||
          source === "library:location" ||
          source === "library:faces" ||
          source === "library:character" ||
          (stage && STAGES.includes(stage as StageId));
        if (!known) fail(`вход ${name}: неизвестный источник ${source}`);
      }
      if (input.whenPrompt !== undefined) {
        try {
          new RegExp(input.whenPrompt, "i");
        } catch {
          fail(`вход ${name}: whenPrompt не регэксп`);
        }
        if (imageMin(input) > 0) fail(`вход ${name}: вход с whenPrompt должен быть необязательным (min: 0)`);
      }
      if (!["first", "newest", "all"].includes(input.pick)) fail(`вход ${name}: pick ${input.pick}`);
    } else if (input.kind === "text") {
      validateTextInput(name, input, inputs, fail);
      if (input.sections !== undefined) {
        if (!input.sections.length) fail(`вход ${name}: пустой sections`);
        for (const section of input.sections) {
          if (!SECTION_NAME.test(section)) fail(`вход ${name}: имя раздела ${section} — строчная латиница, цифры, _`);
        }
        if (input.untitled !== undefined && input.untitled !== "all" && !input.sections.includes(input.untitled)) {
          fail(`вход ${name}: untitled ${input.untitled} — не раздел`);
        }
      }
    } else if (input.kind === "number") {
      if (input.from === "media:duration") {
        if (!input.of || inputs[input.of]?.kind !== "video") fail(`вход ${name}: of должен указывать на вход kind: video`);
      } else if (input.from === "settings:seconds") {
        if (!Number.isInteger(input.min) || !Number.isInteger(input.max) || input.min! > input.max!) {
          fail(`вход ${name}: для settings:seconds нужны целые min <= max`);
        }
        if (input.fallback !== undefined && input.fallback !== "prompt:seconds") {
          fail(`вход ${name}: fallback может быть только prompt:seconds`);
        }
      } else if (input.from !== "prompt:seconds") {
        fail(`вход ${name}: число берётся из prompt:seconds, media:duration или settings:seconds`);
      }
      if (input.fallback !== undefined && input.from !== "settings:seconds") {
        fail(`вход ${name}: fallback только у settings:seconds`);
      }
    } else {
      fail(`вход ${name}: неизвестный kind ${(input as { kind: string }).kind}`);
    }
  }
  validateWhenSketch(binding, inputs, fail);

  const nodeRef = (node: string, field: string | undefined, what: string, json?: string) => {
    const target = graph[node];
    if (!target) fail(`${what}: ноды ${node} нет в графе ${binding.graph}`);
    if (field !== undefined && !(field in target.inputs)) {
      fail(`${what}: у ноды ${node} (${target.class_type}) нет поля ${field} в графе ${binding.graph}`);
    }
    if (json !== undefined) {
      if (field === undefined) fail(`${what}: json без field`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(target.inputs[field!]));
      } catch {
        fail(`${what}: поле ${node}.${field} не JSON-строка в графе ${binding.graph}`);
      }
      const keys = jsonKeys(json);
      if (!keys.length) fail(`${what}: пустой json`);
      if (containerAt(parsed, keys.slice(0, -1)) === undefined) {
        fail(`${what}: в ${node}.${field} нет пути ${keys.slice(0, -1).join(".") || "(корень)"} в графе ${binding.graph}`);
      }
    }
  };

  (binding.slots || []).forEach((slot, index) => {
    const what = `слот ${index + 1}`;
    if (!slot.targets?.length) fail(`${what}: нет targets`);
    for (const target of slot.targets) nodeRef(target.node, target.field, what, target.json);
    for (const removal of slot.whenEmpty?.remove ?? []) {
      nodeRef(removal.node, removal.field, `${what}, whenEmpty`, removal.json);
    }
    const value = slot.value as Record<string, unknown>;
    if (typeof value.input === "string") {
      const input = inputs[value.input];
      if (!input) fail(`${what}: неизвестный вход ${value.input}`);
      if ((value.steps || value.templates || value.section) && input.kind !== "text") {
        fail(`${what}: section, steps и templates только для текста`);
      }
      if (value.section !== undefined && input.kind === "text") {
        const section = String(value.section);
        const perCharacter = section === "{character}" && (binding.forEach === "character" || input.sectionsFrom === "characters");
        if (!perCharacter && !input.sections?.includes(section)) {
          fail(`${what}: у входа ${value.input} нет раздела ${value.section}`);
        }
      }
      if (value.index !== undefined && input.kind !== "image" && input.kind !== "video") fail(`${what}: index только для файлов`);
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
        const kind = template.when ? inputs[template.when.input]?.kind : undefined;
        if (template.when && kind !== "image" && kind !== "video") {
          fail(`${what}: when.input ${template.when.input} — не файл`);
        }
      }
    } else if (Array.isArray(value.inputs)) {
      if (!value.inputs.length) fail(`${what}: пустой inputs`);
      for (const name of value.inputs as unknown[]) {
        const kind = inputs[String(name)]?.kind;
        if (kind !== "image" && kind !== "video") fail(`${what}: inputs — ${String(name)} не вход-файл`);
      }
    } else if (value.seed !== "random" && typeof value.template !== "string" && !("const" in value)) {
      fail(`${what}: значение должно быть input, inputs, seed, template или const`);
    }
  });
}

/** Текст из prompt.md или из метаданных ролика. of/nodes/fallback — только у approve-meta. */
function validateTextInput(
  name: string,
  input: TextInput,
  inputs: Record<string, BindingInput>,
  fail: (message: string) => never,
): void {
  if (input.stage !== undefined && !STAGES.includes(input.stage)) fail(`вход ${name}: неизвестный этап ${input.stage}`);
  if (input.sectionsFrom !== undefined && input.sectionsFrom !== "characters") {
    fail(`вход ${name}: sectionsFrom может быть только characters`);
  }
  if (input.sectionsFrom && input.sections) fail(`вход ${name}: sectionsFrom и sections вместе`);
  if (input.from === "prompt") {
    if (input.of !== undefined || input.nodes !== undefined || input.fallback !== undefined) {
      fail(`вход ${name}: of, nodes и fallback только у from: approve-meta`);
    }
    return;
  }
  if (input.from !== "approve-meta") fail(`вход ${name}: текст берётся из prompt или approve-meta`);
  const source = input.of ? inputs[input.of] : undefined;
  if (!source || source.kind !== "video") fail(`вход ${name}: of должен указывать на вход kind: video`);
  if (source.pick !== "newest") fail(`вход ${name}: у входа ${input.of} pick должен быть newest (самый новый ролик)`);
  if (!input.nodes?.length) fail(`вход ${name}: нужен список nodes — ноды промпта в сохранённом графе`);
  for (const ref of input.nodes) {
    if (!ref?.node || !ref.field) fail(`вход ${name}: nodes — пары { node, field }`);
  }
  if (input.fallback !== undefined && input.fallback !== "prompt") fail(`вход ${name}: fallback может быть только prompt`);
}

/**
 * whenSketch смотрит на ролик другого графа: ноды из манифеста не проверяются против графа этого варианта.
 * Иначе финал LTX не смог бы узнать Wan-ролик и наоборот.
 */
function validateWhenSketch(
  binding: GraphBinding,
  inputs: Record<string, BindingInput>,
  fail: (message: string) => never,
): void {
  const match = binding.whenSketch;
  if (match === undefined) return;
  const source = match.of ? inputs[match.of] : undefined;
  if (!source || source.kind !== "video") fail("whenSketch.of должен указывать на вход kind: video");
  if (source.pick !== "newest") fail(`whenSketch: у входа ${match.of} pick должен быть newest`);
  if (!match.nodes?.length) fail("whenSketch: нужен список nodes");
  for (const ref of match.nodes) {
    if (!ref?.node || !ref.field) fail("whenSketch.nodes — пары { node, field }");
  }
  if (match.filename !== undefined && (typeof match.filename !== "string" || !match.filename.trim() || /[\\/]/.test(match.filename))) {
    fail("whenSketch.filename — непустая подстрока имени файла, без пути");
  }
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
  /** Персонаж этого прогона (`forEach: character`). Без него library:character пуст. */
  character?: string;
}

function listFiles(dir: string, exts: Set<string> = IMAGE_EXT): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => exts.has(path.extname(name).toLowerCase()))
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
  return listFiles(folder).filter((file) => !/copy/i.test(path.basename(file)));
}

function findImage(folder: string, stems: string[]): string | null {
  let names: string[];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return null;
  }
  for (const stem of stems) {
    const found = names.find(
      (name) => IMAGE_EXT.has(path.extname(name).toLowerCase()) && path.parse(name).name.toLowerCase() === stem,
    );
    if (found) return path.join(folder, found);
  }
  return null;
}

/**
 * Лицо персонажа в библиотеке: `face`, `portrait`, `portret` (так названы старые файлы), в том
 * числе с именем персонажа (`Julia_portret.png`, `portret_ivan.png`). Иначе — первая картинка
 * с face/portr в имени, кроме профиля и копий.
 */
export function libraryFace(name: string): string | null {
  const root = getCharactersRoot();
  let folderName: string | undefined;
  try {
    folderName = fs.readdirSync(root).find((item) => item.toLowerCase() === name.toLowerCase());
  } catch {
    return null;
  }
  if (!folderName) return null;
  const folder = path.join(root, folderName);
  const id = name.toLowerCase();
  const stems = ["face", "portrait", "portret"].flatMap((word) => [word, `${id}_${word}`, `${word}_${id}`]);
  return (
    findImage(folder, stems) ??
    listFiles(folder).find((file) => {
      const base = path.basename(file);
      return /face|portr/i.test(base) && !/side|copy/i.test(base);
    }) ??
    null
  );
}

/** Персонажи кадра в порядке файлов approve/ этапа characters: `julia_s05.png` → julia. */
function approvedCharacters(ctx: ShotContext): string[] {
  const suffix = `_${ctx.shotId}`.toLowerCase();
  return listFiles(path.join(stageDir(ctx.episodeId, ctx.shotId, "characters"), "approve")).map((file) => {
    const stem = path.parse(file).name;
    return stem.toLowerCase().endsWith(suffix) ? stem.slice(0, -suffix.length) : stem;
  });
}

/** База персонажа этого прогона: full_body.png, иначе body.png, иначе первая картинка без copy. */
function libraryCharacter(ctx: ShotContext): string[] {
  if (!ctx.character) return [];
  const folder = characterFolder(ctx.character);
  if (!folder) return [];
  const image = characterBaseImage(folder);
  return image ? [image] : [];
}

/** Шаблон имени в refs/: `{character}` и `*`. К библиотеке не применяется. */
function matchName(filename: string, pattern: string, character: string | undefined): boolean {
  const filled = pattern.replaceAll("{character}", (character ?? "").toLowerCase());
  // `*` — любая концовка имени. Сначала экранируем его как обычный символ, потом возвращаем как «.*».
  const body = filled.replace(/[.+?^${}()|[\]\\*]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${body}$`, "i").test(filename);
}

/** Лица по одному на персонажа из approve: `refs/{name}_face.*` этого этапа, иначе библиотека. */
function faceFiles(ctx: ShotContext): string[] {
  const refs = path.join(stageDir(ctx.episodeId, ctx.shotId, ctx.stageId), "refs");
  return approvedCharacters(ctx)
    .map((name) => findImage(refs, [`${name.toLowerCase()}_face`]) ?? libraryFace(name))
    .filter((file): file is string => Boolean(file));
}

function sourceFiles(ctx: ShotContext, source: ImageSource, kind: ImageInput["kind"]): string[] {
  const exts = kind === "video" ? VIDEO_EXT : IMAGE_EXT;
  if (source === "refs") return listFiles(path.join(stageDir(ctx.episodeId, ctx.shotId, ctx.stageId), "refs"), exts);
  if (source === "library:location") {
    return kind === "image" ? libraryLocation(readShotMeta(ctx.episodeId, ctx.shotId).location) : [];
  }
  if (source === "library:faces") return kind === "image" ? faceFiles(ctx) : [];
  if (source === "library:character") return kind === "image" ? libraryCharacter(ctx) : [];
  const stage = source.slice("approve:".length) as StageId;
  return listFiles(path.join(stageDir(ctx.episodeId, ctx.shotId, stage), "approve"), exts);
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

/** Вход с whenPrompt включён: prompt.md этапа совпал с регэкспом. */
export function promptEnablesInput(ctx: ShotContext, input: ImageInput): boolean {
  if (!input.whenPrompt) return true;
  const prompt = readTextIfExists(path.join(stageDir(ctx.episodeId, ctx.shotId, ctx.stageId), "prompt.md"));
  return new RegExp(input.whenPrompt, "i").test(prompt);
}

/** Файл убран пользователем из графа этапа (run_settings.json, excluded). */
function isExcluded(excluded: Set<string>, file: string): boolean {
  if (!excluded.size) return false;
  const media = mediaUrlPath(file);
  return media !== null && excluded.has(media);
}

/** Образец одежды: один референс из refs/, не картинка самого персонажа. */
function usesCharacterClothes(input: ImageInput): boolean {
  return (input.match ?? "").includes("{character}_clothes");
}

/** База персонажа: refs/{имя}_base или библиотека. Сюда же встаёт картинка, выбранная на странице. */
function usesCharacterBase(input: ImageInput): boolean {
  const from = Array.isArray(input.from) ? input.from : [input.from];
  return from.includes("library:character") || (input.match ?? "").includes("{character}_base");
}

/**
 * Картинки входа: первый непустой источник, затем pick. Вход с whenPrompt без совпадения — пусто.
 * Убранные пользователем файлы пропускаются; источник, где остались только они, считается пустым.
 * Выбранная на странице картинка персонажа заменяет базу.
 */
export function resolveImageInput(ctx: ShotContext, input: ImageInput): string[] {
  if (!promptEnablesInput(ctx, input)) return [];
  const excluded = excludedFiles(ctx.episodeId, ctx.shotId, ctx.stageId);
  if (ctx.character && usesCharacterBase(input)) {
    const chosen = chosenCharacterFile(ctx.episodeId, ctx.shotId, ctx.stageId, ctx.character);
    if (chosen && !isExcluded(excluded, chosen)) return [chosen];
  }
  if (ctx.character && usesCharacterClothes(input)) {
    return characterClothingFiles(ctx.episodeId, ctx.shotId, ctx.stageId, ctx.character);
  }
  const sources = Array.isArray(input.from) ? input.from : [input.from];
  for (const source of sources) {
    let files = sourceFiles(ctx, source, input.kind).filter((file) => !isExcluded(excluded, file));
    if (source === "refs" && input.match) {
      files = files.filter((file) => matchName(path.basename(file), input.match!, ctx.character));
    }
    if (files.length) return pickImages(files, input);
  }
  return [];
}

/** Убранные пользователем файлы этого входа (из всех его источников) — чтобы их можно было вернуть. */
export function excludedInputFiles(ctx: ShotContext, input: ImageInput): string[] {
  const excluded = excludedFiles(ctx.episodeId, ctx.shotId, ctx.stageId);
  if (!excluded.size) return [];
  const sources = Array.isArray(input.from) ? input.from : [input.from];
  const files = sources.flatMap((source) => sourceFiles(ctx, source, input.kind));
  return [...new Set(files)].filter((file) => isExcluded(excluded, file));
}

function imageMin(input: ImageInput): number {
  return input.min ?? 1;
}

/** В кадре никого: картинки персонажей не обязательны, первый кадр собирается из локации. */
function imageNeed(ctx: ShotContext, name: string, input: { min?: number }): number {
  if (name === "people" && readShotMeta(ctx.episodeId, ctx.shotId).characters.length === 0) return 0;
  return input.min ?? 1;
}

/** Файл, который слот-картинка получит. index — номер файла внутри его входа (для uploadAs). */
export interface SlotFile {
  name: string;
  input: ImageInput;
  file: string;
  index: number;
}

/**
 * Файл слота `{ input, index }` или `{ inputs, index }` (входы подряд). null — файла нет
 * или слот не про файлы. `images` — уже разобранные входы (resolveImageInput).
 */
export function slotFile(binding: GraphBinding, slot: BindingSlot, images: Record<string, string[]>): SlotFile | null {
  const value = slot.value;
  const names = "inputs" in value ? value.inputs : "input" in value ? [value.input] : [];
  let index = "index" in value && value.index != null ? value.index : 0;
  for (const name of names) {
    const input = binding.inputs[name];
    if (input?.kind !== "image" && input?.kind !== "video") return null;
    const files = images[name] ?? [];
    if (index < files.length) return { name, input, file: files[index], index };
    index -= files.length;
  }
  return null;
}

/** Подписи обязательных входов-картинок, которых не хватает. Текст и число на доступность не влияют. */
export function missingInputs(ctx: ShotContext, binding: GraphBinding): string[] {
  // Прогон на персонажа: база проверяется при запуске, по одному. Меню доступно, пока в кадре есть люди.
  if (binding.forEach === "character") {
    return readShotMeta(ctx.episodeId, ctx.shotId).characters.length ? [] : ["в кадре нет персонажей"];
  }
  const missing: string[] = [];
  for (const [name, input] of Object.entries(binding.inputs)) {
    if (input.kind !== "image" && input.kind !== "video") continue;
    const need = imageNeed(ctx, name, input);
    if (need < 1) continue;
    if (resolveImageInput(ctx, input).length < need) missing.push(input.label);
  }
  return missing;
}

/** Строки инструкции доски из старых prompt.md («Собери shot-вариант…»). */
export const BOARD_INSTRUCTION = /^\s*(Собери |Правила:\s*playbooks\/|Локация:|Персонажи:)/m;

/**
 * Строка с русским текстом (5+ кириллических букв): модели нужен текст на её языке.
 * Не считаются имена персонажей кадра, дословные реплики из speech.md (передаются в names) и длительность («5 сек»).
 */
export function russianLine(text: string, names: string[] = []): string | null {
  for (const line of text.split(/\r?\n/)) {
    let rest = line.replace(/\d+(?:[.,]\d+)?\s*(?:секунд\w*|сек\.?|с(?=\s|$|[.,]))/gi, "");
    for (const name of names.filter(Boolean)) {
      rest = rest.replace(new RegExp(`(?<![\\p{L}])${escapeRegExp(name)}(?![\\p{L}])`, "giu"), "");
    }
    const cyrillic = (rest.match(/[\u0400-\u04ff]/g) || []).length;
    if (cyrillic >= 5) return line.trim();
  }
  return null;
}

/** Для сравнения реплик: регистр, пробелы, кавычки и многоточие не считаются. */
function speechKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Каждая реплика из speech.md стоит в тексте дословно (вход с requireSpeech). Иначе модель,
 * которая сама озвучивает кадр, не будет двигать губами под нужные слова.
 */
export function assertSpeechInText(text: string, speech: string, where = "prompt.md"): void {
  const body = speechKey(text);
  const missing = speechPhrases(speech).filter((phrase) => !body.includes(speechKey(phrase)));
  if (missing.length) {
    throw new Error(
      `В ${where} нет реплик из speech.md: ${missing.map((line) => `«${line}»`).join(", ")}. ` +
        "Их нужно вписать дословно, как диалог: отправь рекомендацию агенту или впиши сам.",
    );
  }
}

/** Путь или имя файла: модель видит картинки по номерам (image 2), а не по путям. */
const FILE_REFERENCE =
  /(?:^|[\s"'(`])(?:data|shots|refs|approve|output|characters|locations)\/|[\w-]+\.(?:png|jpe?g|webp|mp4|webm)\b/i;

export function assertModelText(text: string, where = "prompt.md", names: string[] = []): void {
  const file = text.match(FILE_REFERENCE);
  if (file) {
    throw new Error(
      `${where} ссылается на файл («${file[0].trim()}»). Модель не читает пути: называй картинки по номерам — image 1, image 2.`,
    );
  }
  if (BOARD_INSTRUCTION.test(text)) {
    throw new Error(
      `${where} содержит инструкцию для агента, а не текст для модели: перепиши его или отправь агенту.`,
    );
  }
  const russian = russianLine(text, names);
  if (russian) {
    const preview = russian.length > 80 ? `${russian.slice(0, 80)}…` : russian;
    throw new Error(
      `${where} содержит русский текст («${preview}»). Модель читает только текст на её языке: перепиши промпт или отправь агенту.`,
    );
  }
}

// ---------- разделы prompt.md ----------

const HEADING = /^##[ \t]+(\S+)[ \t]*$/;

/**
 * Делит prompt.md на разделы по строкам `## <имя>`. null — заголовков нет.
 * Текст до первого заголовка и неизвестный заголовок — ошибка.
 */
export function splitSections(text: string, allowed: string[], where = "prompt.md"): Map<string, string> | null {
  const lines = text.split(/\r?\n/);
  if (!lines.some((line) => HEADING.test(line))) return null;
  const sections = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    const body = buffer.join("\n").trim();
    if (current === null) {
      if (body) throw new Error(`${where}: текст до первого заголовка «## …». Разделы: ${allowed.join(", ")}.`);
    } else {
      sections.set(current, body);
    }
    buffer = [];
  };
  for (const line of lines) {
    const match = line.match(HEADING);
    if (!match) {
      buffer.push(line);
      continue;
    }
    flush();
    const name = match[1].toLowerCase();
    if (!allowed.includes(name)) {
      throw new Error(`${where}: неизвестный раздел «## ${match[1]}». Разделы: ${allowed.join(", ")}.`);
    }
    if (sections.has(name)) throw new Error(`${where}: раздел «## ${name}» дважды.`);
    current = name;
  }
  flush();
  return sections;
}

/** Текст раздела. Без заголовков — весь текст, если untitled = all или этот раздел, иначе пусто. */
export function sectionText(text: string, input: TextInput, section: string | undefined, where?: string): string {
  if (!input.sections || section === undefined) return text;
  const parts = splitSections(text, input.sections, where);
  if (!parts) {
    const untitled = input.untitled ?? "all";
    return untitled === "all" || untitled === section ? text : "";
  }
  return parts.get(section) ?? "";
}

// ---------- промпт из метаданных ролика ----------

/**
 * SaveVideo (ComfyUI) кладёт граф API в метаданные контейнера mp4/mov: ключ `prompt`,
 * значение — JSON графа. Флаг ffmpeg `use_metadata_tags` пишет его в `moov/udta/meta`:
 * атом `keys` (имена `mdta`) и `ilst` (значение в атоме `data`, тип 1 — UTF-8).
 * CreateVideo файл не пишет. Нет ключа или это не объект — метаданных промпта нет.
 */
export function readVideoPromptText(
  file: string,
  nodes: PromptNodeRef[],
): { metadata: boolean; text: string | null } {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    return { metadata: false, text: null };
  }
  const raw = readPromptTag(bytes);
  if (raw == null) return { metadata: false, text: null };
  const graph = parsePromptGraph(raw);
  if (!graph) return { metadata: false, text: null };
  return { metadata: true, text: textAtNodes(graph, nodes) };
}

function textAtNodes(graph: Record<string, unknown>, nodes: PromptNodeRef[]): string | null {
  for (const ref of nodes) {
    const node = graph[ref.node];
    if (!node || typeof node !== "object") continue;
    const inputs = (node as { inputs?: unknown }).inputs;
    if (!inputs || typeof inputs !== "object") continue;
    const value = (inputs as Record<string, unknown>)[ref.field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function parsePromptGraph(raw: string): Record<string, unknown> | null {
  try {
    let value: unknown = JSON.parse(raw);
    if (typeof value === "string") value = JSON.parse(value);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readPromptTag(bytes: Buffer): string | null {
  const metas: { start: number; end: number }[] = [];
  const collect = (start: number, end: number) => {
    walkBoxes(bytes, start, end, (type, contentStart, contentEnd) => {
      if (type === "meta") metas.push({ start: contentStart + 4, end: contentEnd });
      else if (type === "moov" || type === "udta") collect(contentStart, contentEnd);
    });
  };
  collect(0, bytes.length);
  for (const meta of metas) {
    if (meta.start >= meta.end) continue;
    const tags = readMetaTags(bytes, meta.start, meta.end);
    const prompt = tags.get("prompt");
    if (prompt != null) return prompt;
  }
  return null;
}

function readMetaTags(bytes: Buffer, start: number, end: number): Map<string, string> {
  let names: string[] = [];
  const values = new Map<number, string>();
  walkBoxes(bytes, start, end, (type, contentStart, contentEnd) => {
    if (type === "keys") names = readMdtaKeys(bytes, contentStart, contentEnd);
    else if (type === "ilst") readIlst(bytes, contentStart, contentEnd, values);
  });
  const tags = new Map<string, string>();
  names.forEach((name, index) => {
    const value = values.get(index + 1);
    if (name && value != null) tags.set(name, value);
  });
  return tags;
}

/** `keys` — full box: версия, число имён, затем атомы `mdta` с именем. */
function readMdtaKeys(bytes: Buffer, start: number, end: number): string[] {
  if (start + 8 > end) return [];
  const count = bytes.readUInt32BE(start + 4);
  const names: string[] = [];
  let offset = start + 8;
  for (let index = 0; index < count && offset + 8 <= end; index += 1) {
    const size = bytes.readUInt32BE(offset);
    if (size < 8 || offset + size > end) break;
    const kind = bytes.toString("latin1", offset + 4, offset + 8);
    names.push(kind === "mdta" ? bytes.toString("utf8", offset + 8, offset + size) : "");
    offset += size;
  }
  return names;
}

/** `ilst`: размер, индекс ключа (с 1), атом `data`. */
function readIlst(bytes: Buffer, start: number, end: number, values: Map<number, string>): void {
  let offset = start;
  while (offset + 8 <= end) {
    const size = bytes.readUInt32BE(offset);
    const index = bytes.readUInt32BE(offset + 4);
    if (size < 8 || offset + size > end) break;
    const text = readDataString(bytes, offset + 8, offset + size);
    if (text != null) values.set(index, text);
    offset += size;
  }
}

function readDataString(bytes: Buffer, start: number, end: number): string | null {
  let offset = start;
  while (offset + 16 <= end) {
    const size = bytes.readUInt32BE(offset);
    if (size < 16 || offset + size > end) break;
    const kind = bytes.toString("latin1", offset + 4, offset + 8);
    if (kind === "data" && bytes.readUInt32BE(offset + 8) === 1) {
      return bytes.toString("utf8", offset + 16, offset + size);
    }
    offset += size;
  }
  return null;
}

function walkBoxes(
  bytes: Buffer,
  start: number,
  end: number,
  visit: (type: string, contentStart: number, contentEnd: number) => void,
): void {
  let offset = start;
  while (offset + 8 <= end) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return;
      const large = bytes.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return;
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) return;
    visit(type, offset + header, offset + size);
    offset += size;
  }
}

interface ResolvedText {
  text: string;
  /** Куда смотреть в тексте ошибки. */
  where: string;
  /** Почему взяли prompt.md: нет метаданных или в них нет текста нод. null — взяли ролик. */
  note: string | null;
}

/** Текст входа. approve-meta читает самый новый ролик `of`; нет текста — fallback prompt.md. */
function resolveTextInput(
  ctx: ShotContext,
  binding: GraphBinding,
  input: TextInput,
  readPrompt: (stage: StageId) => string,
  promptMd: string,
): ResolvedText {
  if (input.from !== "approve-meta") {
    const own = !input.stage || input.stage === ctx.stageId;
    return {
      text: own ? promptMd : readPrompt(input.stage!),
      where: own ? "prompt.md" : `prompt.md этапа ${input.stage}`,
      note: null,
    };
  }
  const source = binding.inputs[input.of ?? ""];
  const file = source && (source.kind === "video" || source.kind === "image") ? resolveImageInput(ctx, source)[0] : undefined;
  const read = file && input.nodes ? readVideoPromptText(file, input.nodes) : { metadata: false, text: null };
  if (read.text) {
    return { text: read.text, where: `метаданные ${path.basename(file!)}`, note: null };
  }
  const stage = input.stage ?? ctx.stageId;
  const own = stage === ctx.stageId;
  const where = own ? "prompt.md" : `prompt.md этапа ${stage}`;
  if (input.fallback !== "prompt") return { text: "", where, note: null };
  const reason = !file
    ? "Утверждённого ролика нет."
    : !read.metadata
      ? `В файле ${path.basename(file)} нет метаданных промпта (SaveVideo, ключ prompt).`
      : `В метаданных ${path.basename(file)} нет текста промпта в нодах манифеста.`;
  return {
    text: own ? promptMd : readPrompt(stage),
    where,
    note: `${reason} В запуск ушёл ${where}.`,
  };
}

/** Та же пометка, что buildPrompt пишет в run_log.md. null — у выбранного воркфлоу метаданные ролика на месте. */
export function sketchPromptTaskNote(ctx: ShotContext, binding: GraphBinding): string | null {
  const readPrompt = (stage: StageId) =>
    readTextIfExists(path.join(stageDir(ctx.episodeId, ctx.shotId, stage), "prompt.md")).trim();
  const promptMd = readPrompt(ctx.stageId);
  const notes: string[] = [];
  for (const input of Object.values(binding.inputs)) {
    if (input.kind !== "text") continue;
    const resolved = resolveTextInput(ctx, binding, input, readPrompt, promptMd);
    if (resolved.note && (resolved.text.trim() || input.required)) notes.push(resolved.note);
  }
  return notes.length ? notes.join("\n") : null;
}

function noteSketchFallback(ctx: ShotContext, note: string): void {
  appendRunLog(ctx.episodeId, ctx.shotId, ctx.stageId, `\n## ${new Date().toISOString()} · доска · промпт эскиза\n\n- ${note}\n`);
}

// ---------- длительность ролика ----------

/** Длительность mp4/mov в секундах по атому mvhd. null — не нашли. */
export function videoDurationSeconds(file: string): number | null {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    return null;
  }
  const at = bytes.indexOf("mvhd");
  if (at < 0 || at + 32 > bytes.length) return null;
  const version = bytes[at + 4];
  let timescale: number;
  let duration: number;
  if (version === 1) {
    timescale = bytes.readUInt32BE(at + 4 + 4 + 16);
    duration = Number(bytes.readBigUInt64BE(at + 4 + 4 + 16 + 4));
  } else {
    timescale = bytes.readUInt32BE(at + 4 + 4 + 8);
    duration = bytes.readUInt32BE(at + 4 + 4 + 8 + 4);
  }
  if (!timescale || !Number.isFinite(duration)) return null;
  return duration / timescale;
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

// ---------- пути внутри JSON-строки ----------

export function jsonKeys(pathText: string): Array<string | number> {
  return pathText
    .split(".")
    .filter((part) => part !== "")
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

function containerAt(root: unknown, keys: Array<string | number>): unknown {
  let node: unknown = root;
  for (const key of keys) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string | number, unknown>)[key];
  }
  return node !== null && typeof node === "object" ? node : undefined;
}

function editJsonField(
  prompt: ApiPrompt,
  node: string,
  field: string,
  edit: (root: unknown) => void,
): void {
  const raw = prompt[node]?.inputs[field];
  if (typeof raw !== "string") throw new Error(`поле ${node}.${field} не строка`);
  const root = JSON.parse(raw);
  edit(root);
  prompt[node].inputs[field] = JSON.stringify(root, null, 2);
}

function setJson(prompt: ApiPrompt, target: NodeTarget, value: unknown): void {
  editJsonField(prompt, target.node, target.field, (root) => {
    const keys = jsonKeys(target.json!);
    const parent = containerAt(root, keys.slice(0, -1)) as Record<string | number, unknown> | undefined;
    if (!parent) throw new Error(`в ${target.node}.${target.field} нет пути ${target.json}`);
    parent[keys[keys.length - 1]] = value;
  });
}

function removeJson(prompt: ApiPrompt, removal: Removal): void {
  if (!prompt[removal.node] || removal.field === undefined) return;
  editJsonField(prompt, removal.node, removal.field, (root) => {
    const keys = jsonKeys(removal.json!);
    const parent = containerAt(root, keys.slice(0, -1));
    const last = keys[keys.length - 1];
    if (Array.isArray(parent) && typeof last === "number") parent.splice(last, 1);
    else if (parent && typeof parent === "object") delete (parent as Record<string | number, unknown>)[last];
  });
}

/** Пути в одном массиве удаляются с конца, чтобы номера оставшихся не сдвигались. */
function removalOrder(a: Removal, b: Removal): number {
  const lastIndex = (removal: Removal) => {
    const keys = removal.json ? jsonKeys(removal.json) : [];
    const last = keys[keys.length - 1];
    return typeof last === "number" ? last : -1;
  };
  return lastIndex(b) - lastIndex(a);
}

// ---------- сборка ----------

function inRange(value: number, input: NumberInput): boolean {
  return (input.min == null || value >= input.min) && (input.max == null || value <= input.max);
}

/** Число, прижатое к min..max входа (clamp: true). */
function clampToRange(value: number, input: NumberInput): number {
  const low = input.min ?? value;
  const high = input.max ?? value;
  return Math.min(high, Math.max(low, value));
}

function numberValue(
  input: NumberInput,
  promptMd: string,
  files: Record<string, string[]>,
  durationSec: number | undefined,
): number | null {
  if (input.from === "settings:seconds") {
    if (typeof durationSec === "number" && Number.isFinite(durationSec) && inRange(durationSec, input)) return durationSec;
    return input.fallback === "prompt:seconds" ? secondsInText(promptMd, input) : null;
  }
  if (input.from === "media:duration") {
    const file = files[input.of!]?.[0];
    const seconds = file ? videoDurationSeconds(file) : null;
    if (seconds == null) return null;
    const rounded = Math.round(seconds);
    if (input.clamp) return clampToRange(rounded, input);
    return inRange(rounded, input) ? rounded : null;
  }
  return secondsInText(promptMd, input);
}

/** Вход-число с источником settings:seconds (меню длительности). null — у манифеста его нет. */
export function settingsSecondsInput(binding: GraphBinding): { name: string; input: NumberInput } | null {
  for (const [name, input] of Object.entries(binding.inputs)) {
    if (input.kind === "number" && input.from === "settings:seconds") return { name, input };
  }
  return null;
}

/**
 * Меню длительности для манифеста: min..max входа settings:seconds и число «по умолчанию»
 * (секунды из prompt.md, если fallback, иначе значение графа в первом target). null — меню нет.
 */
export function durationRange(binding: GraphBinding, graph: ApiPrompt, ctx: ShotContext): DurationRange | null {
  const found = settingsSecondsInput(binding);
  if (!found) return null;
  const { name, input } = found;
  const target = binding.slots.find((slot) => "input" in slot.value && slot.value.input === name)?.targets[0];
  let graphValue: unknown = target ? graph[target.node]?.inputs[target.field] : undefined;
  if (target?.json && typeof graphValue === "string") {
    try {
      const keys = jsonKeys(target.json);
      const parent = containerAt(JSON.parse(graphValue), keys.slice(0, -1)) as Record<string | number, unknown> | undefined;
      graphValue = parent?.[keys[keys.length - 1]];
    } catch {
      graphValue = undefined;
    }
  }
  const promptMd =
    input.fallback === "prompt:seconds"
      ? readTextIfExists(path.join(stageDir(ctx.episodeId, ctx.shotId, ctx.stageId), "prompt.md")).trim()
      : "";
  const fromPrompt = promptMd ? secondsInText(promptMd, input) : null;
  const fallback = fromPrompt ?? (typeof graphValue === "number" ? graphValue : input.min!);
  return { min: input.min!, max: input.max!, default: fallback };
}

/**
 * Длительность этапа для воркфлоу `workflowId`: меню (`range`) и выбор из run_settings.json (`durationSec`).
 * Выбор вне min..max этого воркфлоу не считается: уйдёт число по умолчанию.
 */
export function stageDuration(
  ctx: ShotContext,
  workflowId: string | null,
): { range: DurationRange | null; durationSec: number | null } {
  const found = workflowId ? stageBindings(ctx.stageId).find((item) => item.id === workflowId) : undefined;
  if (!found?.binding || !found.graph || found.error) return { range: null, durationSec: null };
  const range = durationRange(found.binding, found.graph, ctx);
  if (!range) return { range: null, durationSec: null };
  const stored = readRunSettings(ctx.episodeId, ctx.shotId, ctx.stageId).durationSec;
  const valid = typeof stored === "number" && stored >= range.min && stored <= range.max;
  return { range, durationSec: valid ? stored : null };
}

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
    character: (ctx.character ?? "").toLowerCase(),
  });
}

/** Разделы по именам персонажей кадра, если манифест просит sectionsFrom. */
function textInputFor(input: TextInput, characters: string[]): TextInput {
  if (input.sectionsFrom !== "characters") return input;
  return { ...input, sections: characters.map((name) => name.toLowerCase()) };
}

/**
 * prompt для ComfyUI из манифеста, графа и папок кадра. Пути uploads — абсолютные.
 * Ошибки: нет обязательного входа, пустой обязательный prompt.md, инструкция доски в prompt.md.
 */
export function buildPrompt(binding: GraphBinding, graph: ApiPrompt, ctx: BuildContext): BuiltPrompt {
  const prompt = structuredClone(graph);
  const seed = ctx.random ?? newSeed;
  const meta = readShotMeta(ctx.episodeId, ctx.shotId);
  const readPrompt = (stage: StageId) =>
    readTextIfExists(path.join(stageDir(ctx.episodeId, ctx.shotId, stage), "prompt.md")).trim();
  const promptMd = readPrompt(ctx.stageId);
  const durationSec = readRunSettings(ctx.episodeId, ctx.shotId, ctx.stageId).durationSec;
  const texts: Record<string, string> = {};
  // Реплики из speech.md звучат на своём языке: проверка языка их пропускает.
  const allowed = [...meta.characters, ...speechPhrases(readShotSpeech(ctx.episodeId, ctx.shotId))];

  const images: Record<string, string[]> = {};
  const missing: string[] = [];
  for (const [name, input] of Object.entries(binding.inputs)) {
    if (input.kind === "image" || input.kind === "video") {
      images[name] = resolveImageInput(ctx, input);
      if (images[name].length < imageNeed(ctx, name, input)) missing.push(input.label);
    } else if (input.kind === "text") {
      const textInput = textInputFor(input, meta.characters);
      const resolved = resolveTextInput(ctx, binding, textInput, readPrompt, promptMd);
      texts[name] = resolved.text;
      if (resolved.note && (resolved.text.trim() || textInput.required)) noteSketchFallback(ctx, resolved.note);
      if (textInput.required && !texts[name]) {
        throw new Error(`В ${resolved.where} нет текста для модели. Отправь рекомендацию агенту или впиши промпт сам.`);
      }
      assertModelText(texts[name], resolved.where, allowed);
      if (textInput.sections) splitSections(texts[name], textInput.sections, resolved.where);
      if (textInput.requireSpeech) assertSpeechInText(texts[name], readShotSpeech(ctx.episodeId, ctx.shotId), resolved.where);
    }
  }
  if (missing.length) throw new Error(`Для «${binding.label}» не хватает: ${missing.join(", ")}.`);
  const counts = Object.fromEntries(Object.entries(images).map(([name, files]) => [name, files.length]));

  const uploads: BuiltPrompt["uploads"] = [];
  const removals: Removal[] = [];
  const writeTarget = (target: NodeTarget, value: unknown) => {
    if (target.json) setJson(prompt, target, value);
    else prompt[target.node].inputs[target.field] = value;
  };
  const write = (slot: BindingSlot, value: unknown) => {
    for (const target of slot.targets) writeTarget(target, value);
  };
  /** Значения нет: whenEmpty, иначе ошибка для обязательного входа, иначе значение графа. */
  const empty = (slot: BindingSlot, input: BindingInput, required: boolean) => {
    if (slot.whenEmpty) removals.push(...slot.whenEmpty.remove);
    else if (required) throw new Error(`Для «${binding.label}» не хватает: ${input.label}.`);
  };

  for (const slot of binding.slots) {
    const value = slot.value;
    if ("seed" in value) {
      const limit = typeof value.max === "number" && value.max > 0 ? value.max : null;
      for (const target of slot.targets) writeTarget(target, limit ? seed() % (limit + 1) : seed());
      continue;
    }
    if ("const" in value) {
      write(slot, structuredClone(value.const));
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
          character: (ctx.character ?? "").toLowerCase(),
        }),
      );
      continue;
    }
    const names = "inputs" in value ? value.inputs : [value.input];
    const input = binding.inputs[names[0]];
    if (input.kind === "image" || input.kind === "video") {
      const found = slotFile(binding, slot, images);
      if (!found) {
        // Ряд входов: слот обязателен, только если это один из обязательных файлов первого входа.
        const index = "index" in value && value.index != null ? value.index : 0;
        const need = imageNeed(ctx, names[0], input);
        empty(slot, input, "inputs" in value ? need > index : need >= 1);
        continue;
      }
      const filename = uploadName(found.input, found.file, found.index, ctx);
      if (!uploads.some((item) => item.path === found.file && item.filename === filename)) {
        uploads.push({ path: found.file, filename });
      }
      write(slot, filename);
    } else if ("inputs" in value) {
      continue;
    } else if (input.kind === "text") {
      const textInput = textInputFor(input, meta.characters);
      const steps = "steps" in value ? value.steps : undefined;
      const templates = "templates" in value ? value.templates : undefined;
      const rawSection = "section" in value ? value.section : undefined;
      const section = rawSection === "{character}" ? ctx.character?.toLowerCase() : rawSection;
      const source = sectionText(texts[value.input], textInput, section);
      let text = steps?.length ? applySteps(source, steps, meta.characters) : source;
      const template = templates?.length ? pickTemplate(templates, counts) : null;
      if (template) {
        text = renderTemplate(template.text, { text, shotId: ctx.shotId, episodeId: ctx.episodeId });
      }
      const required = section !== undefined ? "required" in value && value.required === true : input.required;
      if (!text.trim()) {
        if (section !== undefined && required && !slot.whenEmpty) {
          throw new Error(`В prompt.md нет раздела «## ${section}» для «${binding.label}».`);
        }
        empty(slot, input, required);
      } else write(slot, text);
    } else {
      const seconds = numberValue(input as NumberInput, promptMd, images, durationSec);
      if (seconds == null) empty(slot, input, false);
      else write(slot, seconds);
    }
  }

  for (const removal of [...removals].sort(removalOrder)) {
    if (removal.json) removeJson(prompt, removal);
    else if (removal.field === undefined) delete prompt[removal.node];
    else if (prompt[removal.node]) delete prompt[removal.node].inputs[removal.field];
  }
  return { prompt, uploads };
}
