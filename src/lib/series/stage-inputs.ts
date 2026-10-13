import fs from "fs";
import path from "path";
import type { ImageInput, ImageSource } from "../contracts/graph-binding";
import {
  excludedInputFiles,
  promptEnablesInput,
  resolveImageInput,
  stageBindings,
  type ShotContext,
} from "../comfy/binding";
import { resolveWorkflowId } from "../comfy/workflows";
import { characterBaseImage, characterFolder, missingCharacterBase, missingCharacterClothes } from "./character-base";
import { STAGE_LABELS, type StageId } from "./constants";
import { mediaKind, mediaUrlPath } from "./media";
import { getCharactersRoot, getDataRoot, getLocationsRoot, stageDir, toPosix } from "./paths";
import { chosenCharacterFile, excludedFiles, readRunSettings } from "./run-settings";
import { readShotMeta } from "./shot-meta";
import type { MediaFile, StageInput } from "./types";

/*
 * Входы этапа для страницы: что граф возьмёт по умолчанию, даже если это утверждено
 * на другом этапе или лежит в общей библиотеке. Только чтение.
 */

function mediaFileAt(absolute: string): MediaFile | null {
  const relativePath = mediaUrlPath(absolute);
  if (!relativePath) return null;
  let version = 0;
  try {
    version = Math.floor(fs.statSync(absolute).mtimeMs);
  } catch {
    return null;
  }
  return {
    name: path.basename(absolute),
    relativePath,
    kind: mediaKind(absolute),
    url: `/api/media/${relativePath.split("/").map(encodeURIComponent).join("/")}?v=${version}`,
  };
}

function dataLabel(absoluteDir: string): string {
  return `data/${toPosix(path.relative(getDataRoot(), absoluteDir))}/`;
}

function sourceLabel(ctx: ShotContext, source: ImageSource, files: string[]): string {
  if (source === "refs") return "refs/ этого этапа";
  if (source === "library:location") {
    const folder = files[0]
      ? path.dirname(files[0])
      : path.join(getLocationsRoot(), readShotMeta(ctx.episodeId, ctx.shotId).location || "?");
    return `библиотека ${dataLabel(folder)}`;
  }
  if (source === "library:faces") return `лица: refs/{имя}_face или ${dataLabel(getCharactersRoot())}`;
  const stage = source.slice("approve:".length) as StageId;
  return `approve этапа ${STAGE_LABELS[stage] ?? stage}`;
}

function mediaFiles(files: string[]): MediaFile[] {
  return files.map(mediaFileAt).filter((file): file is MediaFile => file !== null);
}

/** Вход манифеста: первый непустой источник, как при запуске (resolveImageInput). */
function bindingInput(ctx: ShotContext, input: ImageInput): StageInput {
  const sources = Array.isArray(input.from) ? input.from : [input.from];
  const excluded = mediaFiles(excludedInputFiles(ctx, input));
  if (!promptEnablesInput(ctx, input)) {
    // Вход по фразе в промпте: показываем, что уйдёт, если промпт его позовёт.
    return {
      label: input.label,
      source: "сейчас не уйдёт: prompt.md этот вход не зовёт",
      files: mediaFiles(resolveImageInput(ctx, { ...input, whenPrompt: undefined })),
      excluded,
    };
  }
  for (const source of sources) {
    const files = resolveImageInput(ctx, { ...input, from: source });
    if (files.length) {
      return { label: input.label, source: sourceLabel(ctx, source, files), files: mediaFiles(files), excluded };
    }
  }
  return {
    label: input.label,
    source: `пусто: ${sources.map((source) => sourceLabel(ctx, source, [])).join(" или ")}`,
    files: [],
    excluded,
  };
}

/** Делит файлы на оставленные и убранные пользователем из графа. */
function splitExcluded(files: MediaFile[], excluded: Set<string>): { files: MediaFile[]; excluded: MediaFile[] } {
  return {
    files: files.filter((file) => !excluded.has(file.relativePath)),
    excluded: files.filter((file) => excluded.has(file.relativePath)),
  };
}

function workflowInputs(ctx: ShotContext): StageInput[] {
  const { episodeId, shotId, stageId } = ctx;
  let id: string | null = null;
  try {
    id = resolveWorkflowId(episodeId, shotId, stageId, readRunSettings(episodeId, shotId, stageId).workflow);
  } catch {
    // В run_settings.json устаревший id: показываем вариант по умолчанию.
    id = resolveWorkflowId(episodeId, shotId, stageId);
  }
  const binding = stageBindings(stageId).find((item) => item.id === id)?.binding;
  if (!binding) return [];
  return Object.values(binding.inputs)
    .filter((input): input is ImageInput => input.kind === "image" || input.kind === "video")
    .map((input) => bindingInput(ctx, input));
}

/** Файл пользователя в refs/: `{имя}_base*` или `{имя}_clothes*`. Другие файлы refs/ в граф не идут. */
function refByStem(ctx: ShotContext, name: string, kind: "base" | "clothes"): string | null {
  const refs = path.join(stageDir(ctx.episodeId, ctx.shotId, ctx.stageId), "refs");
  let names: string[];
  try {
    names = fs.readdirSync(refs);
  } catch {
    return null;
  }
  const stem = `${name.toLowerCase()}_${kind}`;
  const found = names
    .filter((file) => file.toLowerCase().startsWith(stem) && /\.(png|jpe?g|webp)$/i.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return found[0] ? path.join(refs, found[0]) : null;
}

/**
 * В граф идут база и, если пользователь положил, образец одежды.
 * База: refs/{имя}_base.*, иначе библиотека. Нет образца — нода image 2 в bypass.
 * Не full_body.png — подсказка положить картинку во весь рост. Лист доска не режет.
 */
function characterInputs(ctx: ShotContext): StageInput[] {
  const { episodeId, shotId, stageId } = ctx;
  const excluded = excludedFiles(episodeId, shotId, stageId);
  const inputs: StageInput[] = [];
  for (const name of readShotMeta(episodeId, shotId).characters) {
    const fromRefs = refByStem(ctx, name, "base");
    const folder = characterFolder(name);
    const fromLibrary = folder ? characterBaseImage(folder) : null;
    const manual = chosenCharacterFile(episodeId, shotId, stageId, name);
    const manualPath = manual ? mediaUrlPath(manual) : null;
    const manualActive = Boolean(manual && manualPath && !excluded.has(manualPath));
    const automatic = fromRefs ?? fromLibrary;
    const shown = manualActive && manual ? [manual] : automatic ? [automatic] : [];
    const heldBack = manual && !manualActive ? [manual] : [];
    const hint =
      !manualActive && automatic && path.basename(automatic).toLowerCase() !== "full_body.png"
        ? " Положите full_body.png во весь рост."
        : "";
    let source: string;
    if (manualActive && manual) {
      source = `выбран вручную (${path.basename(manual)}). Это персонаж в графе; одежду меняет образец или текст.`;
    } else if (!automatic) {
      source = missingCharacterBase(name);
    } else if (fromRefs) {
      source = `refs/ этого этапа (${path.basename(fromRefs)}).${hint}`;
    } else {
      source = `библиотека ${dataLabel(folder!)} (${path.basename(fromLibrary!)}).${hint}`;
    }
    inputs.push({
      label: `Персонаж ${name}`,
      characterName: name,
      source,
      ...splitExcluded(mediaFiles([...shown, ...heldBack]), excluded),
    });
    const clothes = refByStem(ctx, name, "clothes");
    inputs.push({
      label: `Одежда ${name}`,
      source: clothes ? `refs/ этого этапа (${path.basename(clothes)}).` : missingCharacterClothes(name),
      ...splitExcluded(clothes ? mediaFiles([clothes]) : [], excluded),
    });
  }
  return inputs;
}

export function stageInputs(episodeId: string, shotId: string, stageId: StageId): StageInput[] {
  const ctx: ShotContext = { episodeId, shotId, stageId };
  if (stageId === "characters") return characterInputs(ctx);
  if (stageBindings(stageId).length) return workflowInputs(ctx);
  return [];
}
