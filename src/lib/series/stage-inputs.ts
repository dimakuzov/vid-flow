import fs from "fs";
import path from "path";
import type { ImageInput, ImageSource } from "../contracts/graph-binding";
import { resolveImageInput, stageBindings, type ShotContext } from "../comfy/binding";
import { resolveWorkflowId } from "../comfy/workflows";
import { STAGE_LABELS, type StageId } from "./constants";
import { listMediaFiles, mediaKind, mediaUrlPath } from "./media";
import { getCharactersRoot, getDataRoot, getLocationsRoot, stageDir, toPosix } from "./paths";
import { readRunSettings } from "./run-settings";
import { readShotMeta } from "./shot-meta";
import type { MediaFile, StageInput } from "./types";

/*
 * Входы этапа для страницы: что граф возьмёт по умолчанию, даже если это утверждено
 * на другом этапе или лежит в общей библиотеке. Только чтение.
 */

/**
 * База персонажа в data/characters/{name}/, по порядку показа: каноническое имя и старые имена
 * из исходных заметок (`body.png`, `portret.png`, `portret_side.png`).
 */
const CHARACTER_BASE = [
  ["full_body.png", "body.png"],
  ["portrait.png", "portret.png"],
  ["side.png", "portret_side.png"],
];
const IMAGE = /\.(png|jpe?g|webp)$/i;

/** Картинки базы: канонические или старые имена; нет ни одного — любые картинки папки, кроме копий. */
function characterBaseFiles(folder: string): string[] {
  const named = CHARACTER_BASE.map((names) => names.map((name) => path.join(folder, name)).find((file) => fs.existsSync(file)))
    .filter((file): file is string => Boolean(file));
  if (named.length) return named;
  try {
    return fs
      .readdirSync(folder)
      .filter((name) => IMAGE.test(name) && !/copy/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name) => path.join(folder, name))
      .filter((file) => fs.statSync(file).isFile());
  } catch {
    return [];
  }
}

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

function libraryFolder(root: string, name: string): string | null {
  if (!name) return null;
  try {
    const found = fs.readdirSync(root).find((item) => item.toLowerCase() === name.toLowerCase());
    return found ? path.join(root, found) : null;
  } catch {
    return null;
  }
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
  const stage = source.slice("approve:".length) as StageId;
  return `approve этапа ${STAGE_LABELS[stage] ?? stage}`;
}

/** Вход манифеста: первый непустой источник, как при запуске (resolveImageInput). */
function bindingInput(ctx: ShotContext, input: ImageInput): StageInput {
  const sources = Array.isArray(input.from) ? input.from : [input.from];
  for (const source of sources) {
    const files = resolveImageInput(ctx, { ...input, from: source });
    if (files.length) {
      return {
        label: input.label,
        source: sourceLabel(ctx, source, files),
        fromRefs: source === "refs",
        files: files.map(mediaFileAt).filter((file): file is MediaFile => file !== null),
      };
    }
  }
  return {
    label: input.label,
    source: `пусто: ${sources.map((source) => sourceLabel(ctx, source, [])).join(" или ")}`,
    fromRefs: false,
    files: [],
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

/** Этап персонажей (воркфлоу доски нет): база каждого персонажа и образцы одежды из refs/. */
function characterInputs(ctx: ShotContext): StageInput[] {
  const { episodeId, shotId, stageId } = ctx;
  const inputs: StageInput[] = readShotMeta(episodeId, shotId).characters.map((name) => {
    const folder = libraryFolder(getCharactersRoot(), name);
    const files = folder
      ? characterBaseFiles(folder)
          .map(mediaFileAt)
          .filter((file): file is MediaFile => file !== null)
      : [];
    return {
      label: `Персонаж ${name}`,
      source: folder
        ? `библиотека ${dataLabel(folder)}`
        : `пусто: нет папки ${dataLabel(path.join(getCharactersRoot(), name))}`,
      fromRefs: false,
      files,
    };
  });
  inputs.push({
    label: "Образцы одежды",
    source: "refs/ этого этапа",
    fromRefs: true,
    files: listMediaFiles(path.join(stageDir(episodeId, shotId, stageId), "refs")),
  });
  return inputs;
}

export function stageInputs(episodeId: string, shotId: string, stageId: StageId): StageInput[] {
  const ctx: ShotContext = { episodeId, shotId, stageId };
  if (stageBindings(stageId).length) return workflowInputs(ctx);
  if (stageId === "characters") return characterInputs(ctx);
  return [];
}
