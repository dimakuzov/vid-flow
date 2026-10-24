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
import {
  characterBaseImage,
  characterClothingFiles,
  characterFolder,
  missingCharacterBase,
  missingCharacterClothes,
  tooManyClothingRefs,
} from "./character-base";
import type { StageId } from "./constants";
import { mediaKind, mediaUrlPath } from "./media";
import { getCharactersRoot, getDataRoot, getLocationsRoot, stageDir, toPosix } from "./paths";
import { chosenCharacterFile, excludedFiles, readRunSettings } from "./run-settings";
import { readShotMeta } from "./shot-meta";

/** Stage names for the source text shown on the stage page. */
const STAGE_NAMES: Record<string, string> = {
  characters: "Characters",
  location: "Location",
  first_frame: "First frame",
  video_preview: "Video (preview)",
  final_render: "Final render",
};
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
  if (source === "refs") return "refs/ of this stage";
  if (source === "refs:other") return "refs/ of this stage, except {name}_face, _base, _clothes";
  if (source.startsWith("refs:")) {
    const other = source.slice("refs:".length) as StageId;
    return `refs/ of stage ${STAGE_NAMES[other] ?? other}`;
  }
  if (source === "library:location") {
    const folder = files[0]
      ? path.dirname(files[0])
      : path.join(getLocationsRoot(), readShotMeta(ctx.episodeId, ctx.shotId).location || "?");
    return `library ${dataLabel(folder)}`;
  }
  if (source === "library:faces") return `faces: refs/{name}_face or ${dataLabel(getCharactersRoot())}`;
  if (source === "library:face-sheets") {
    return `face sheets: refs/{name}_face_sheet or *face_sheet* in ${dataLabel(getCharactersRoot())}`;
  }
  if (source === "library:faces-or-characters") {
    return `per character: face (refs/{name}_face or ${dataLabel(getCharactersRoot())}), otherwise approve of stage ${STAGE_NAMES.characters}`;
  }
  const stage = source.slice("approve:".length) as StageId;
  return `approve of stage ${STAGE_NAMES[stage] ?? stage}`;
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
      source: "not sent now: prompt.md does not call this input",
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
    source: `empty: ${sources.map((source) => sourceLabel(ctx, source, [])).join(" or ")}`,
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
        ? " Put a full-length full_body.png there."
        : "";
    let source: string;
    if (manualActive && manual) {
      source = `picked by hand (${path.basename(manual)}). This is the character in the graph; the outfit changes by a sample or by text.`;
    } else if (!automatic) {
      source = missingCharacterBase(name);
    } else if (fromRefs) {
      source = `refs/ of this stage (${path.basename(fromRefs)}).${hint}`;
    } else {
      source = `library ${dataLabel(folder!)} (${path.basename(fromLibrary!)}).${hint}`;
    }
    inputs.push({
      label: `Персонаж ${name}`,
      characterName: name,
      source,
      ...splitExcluded(mediaFiles([...shown, ...heldBack]), excluded),
    });
    const clothes = characterClothingFiles(episodeId, shotId, stageId, name);
    const clothesSource =
      clothes.length > 1
        ? tooManyClothingRefs(name, clothes.length)
        : clothes.length === 1
          ? `refs/ of this stage (${path.basename(clothes[0])}). The second image of the graph.`
          : missingCharacterClothes(name);
    inputs.push({
      label: `Одежда ${name}`,
      source: clothesSource,
      ...splitExcluded(mediaFiles(clothes), excluded),
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
