import crypto from "crypto";
import fs from "fs";
import path from "path";
import { claudeOneShot, claudeOneShotAvailable, visionModel } from "../agent/claude-oneshot";
import { registerLoop } from "../background";
import type { StageId } from "./constants";
import { mediaUrlPath } from "./media";
import { getDataRoot, listShotIds, readCurrentEpisodeId, stageDir } from "./paths";
import { excludedFiles } from "./run-settings";

/*
 * Описания утверждённых картинок (локация, персонажи, первый кадр): что на них на самом деле.
 * Делает модель со зрением, один раз на содержимое файла: ключ — sha256, поэтому один и тот же
 * файл в разных кадрах смотрится один раз, а новый файл на месте утверждённого — заново.
 * Хранятся в `data/descriptions/{sha256}.json`. Пишет только доска.
 */

export type DescriptionKind = "location" | "character" | "first_frame";

export interface ImageDescription {
  sha256: string;
  kind: DescriptionKind;
  text: string;
  model: string;
  createdAt: string;
  /** Где файл был, когда его описали (`episodes/…`). Только для справки. */
  source: string | null;
}

/** Утверждённая картинка кадра, которую агент должен знать. */
export interface ApprovedImage {
  kind: DescriptionKind;
  /** Имя персонажа (`lena`); у локации и первого кадра — null. */
  subject: string | null;
  file: string;
}

const IMAGE = /\.(png|jpe?g|webp)$/i;

/** Этапы, которым нужны описания картинок и действие кадра. */
export const CONTEXT_STAGES: StageId[] = ["first_frame", "video_preview", "final_render"];

export function descriptionsRoot(): string {
  return path.join(getDataRoot(), "descriptions");
}

// ---------- sha256 с кэшем по mtime и размеру ----------

const HASH_KEY = "__frameboardImageHashes";

function hashCache(): Map<string, { mtimeMs: number; size: number; sha256: string }> {
  const g = globalThis as typeof globalThis & { [HASH_KEY]?: Map<string, { mtimeMs: number; size: number; sha256: string }> };
  if (!g[HASH_KEY]) g[HASH_KEY] = new Map();
  return g[HASH_KEY]!;
}

export function fileSha256(file: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const cached = hashCache().get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.sha256;
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  hashCache().set(file, { mtimeMs: stat.mtimeMs, size: stat.size, sha256 });
  return sha256;
}

// ---------- какие картинки описывать ----------

function images(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => IMAGE.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function newest(files: string[]): string | null {
  let best: { file: string; mtime: number } | null = null;
  for (const file of files) {
    const mtime = fs.statSync(file).mtimeMs;
    if (!best || mtime > best.mtime) best = { file, mtime };
  }
  return best?.file ?? null;
}

/** `lena_s05.png` → lena. */
function characterName(file: string, shotId: string): string {
  const stem = path.parse(file).name;
  const suffix = `_${shotId}`.toLowerCase();
  return stem.toLowerCase().endsWith(suffix) ? stem.slice(0, -suffix.length) : stem;
}

/**
 * Утверждённые картинки кадра так, как их возьмёт граф первого кадра: самая новая локация,
 * персонажи из approve (без убранных на этапе первого кадра), самый новый первый кадр.
 */
export function approvedImages(episodeId: string, shotId: string): ApprovedImage[] {
  const out: ApprovedImage[] = [];
  const location = newest(images(path.join(stageDir(episodeId, shotId, "location"), "approve")));
  if (location) out.push({ kind: "location", subject: null, file: location });
  const excluded = excludedFiles(episodeId, shotId, "first_frame");
  for (const file of images(path.join(stageDir(episodeId, shotId, "characters"), "approve"))) {
    const media = mediaUrlPath(file);
    if (media && excluded.has(media)) continue;
    out.push({ kind: "character", subject: characterName(file, shotId), file });
  }
  const first = newest(images(path.join(stageDir(episodeId, shotId, "first_frame"), "approve")));
  if (first) out.push({ kind: "first_frame", subject: null, file: first });
  return out;
}

// ---------- хранилище ----------

function descriptionFile(sha256: string): string {
  return path.join(descriptionsRoot(), `${sha256}.json`);
}

export function readDescription(sha256: string): ImageDescription | null {
  try {
    const data = JSON.parse(fs.readFileSync(descriptionFile(sha256), "utf8")) as ImageDescription;
    return data && typeof data.text === "string" && data.text.trim() ? data : null;
  } catch {
    return null;
  }
}

function writeDescription(description: ImageDescription): void {
  fs.mkdirSync(descriptionsRoot(), { recursive: true });
  const file = descriptionFile(description.sha256);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(description, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

// ---------- задание модели ----------

const RULES = `Describe only what is actually visible in the picture. Do not guess, do not invent, do not use any story. If something is unclear, say "unclear". Plain English sentences, no headings, no Markdown, no lists.`;

export function describeTask(kind: DescriptionKind): string {
  if (kind === "location") {
    return `This picture is the fixed background (location) of one shot of a film. A character will later be placed into it without changing the picture.

${RULES}

Cover, in this order:
1. What kind of place this is, and how many separate spaces are actually visible (one space, or two or more joined by an opening). Name each space by what it is, and which part of it is in the frame.
2. The size of each space, as far as the picture shows: narrow or wide, low or tall, and a rough distance in metres from the camera to the far end and across the floor where a person could stand. If metres are unclear, say so, and still compare the size to a standing person.
3. The camera: its height, angle, and which way it looks.
4. Three depth layers, each named: foreground, middle ground, background. For each layer, the surfaces, objects and openings, and where they sit (left, right, centre).
5. Every opening that joins spaces: where it is, whether it is shut, partly open or fully open, and which space is visible through it. Obstacles a person cannot walk through.
6. Where a person can stand or walk in each space, and how far apart two people would be if one stood in one visible space and another in the next. From which side someone could enter.
7. The light: sources, direction, how bright, time of day, weather, colour.
8. What a viewer might expect in such a place but is NOT in the picture.

Under 260 words.`;
  }
  if (kind === "character") {
    return `This picture is the reference of one character of a film. The character will later be placed into shots exactly as they look here.

${RULES}

Cover, in this order:
1. Gender, approximate age, build.
2. Hair: colour, length, style. Glasses, beard or other features of the face if visible.
3. Every piece of clothing from top to bottom: colour, material, length, fastening. Shoes.
4. Bags and other items: their exact shape and how they are worn (for example: a soft black drawstring sack bag on a strap over the right shoulder, not a satchel).
5. The pose: full figure or not, which way the body and the face are turned, where the hands are.

Under 150 words. Do not name the character.`;
  }
  return `This picture is the approved first frame of one shot of a film. People have already been placed into the location. A video will start from exactly this frame.

${RULES}

Cover, in this order:
1. How many people are in the frame. If there are none, say so and go on to the place.
2. Each person, nearest first: which space they stand in, and where (left, right, centre; foreground, middle ground or background). The pose, which way the body and the face are turned, where they look, and whether the face is visible. A rough percent of the picture area taken by the face, and a rough percent taken by the whole body. If a percent is unclear, say so. Clothes and items, briefly.
3. The place, the same facts as for an empty location: how many separate spaces are visible and the rough size of each; the camera height and angle; foreground, middle ground and background; openings and whether each is shut, partly open or fully open; obstacles a person cannot walk through; how far the people are from each other and from the far end of the space.
4. The light: sources, direction, how bright, colour.

Under 280 words.`;
}

const INFLIGHT_KEY = "__frameboardDescribing";
const FAILED_KEY = "__frameboardDescribeFailed";

function inflight(): Map<string, Promise<ImageDescription | null>> {
  const g = globalThis as typeof globalThis & { [INFLIGHT_KEY]?: Map<string, Promise<ImageDescription | null>> };
  if (!g[INFLIGHT_KEY]) g[INFLIGHT_KEY] = new Map();
  return g[INFLIGHT_KEY]!;
}

/** sha256 → время последней неудачи: фоновый цикл не повторяет её каждый проход. */
function failures(): Map<string, number> {
  const g = globalThis as typeof globalThis & { [FAILED_KEY]?: Map<string, number> };
  if (!g[FAILED_KEY]) g[FAILED_KEY] = new Map();
  return g[FAILED_KEY]!;
}

const RETRY_AFTER_MS = 10 * 60 * 1000;

export function describingNow(sha256: string): boolean {
  return inflight().has(sha256);
}

/**
 * Описание картинки: из хранилища, иначе модель смотрит её сейчас. Одновременные вызовы
 * для одного содержимого ждут один и тот же запрос. null — описать не вышло.
 */
export function ensureDescription(
  image: ApprovedImage,
  signal: AbortSignal,
  options: { retryFailed?: boolean } = {},
): Promise<ImageDescription | null> {
  const sha256 = fileSha256(image.file);
  if (!sha256) return Promise.resolve(null);
  const stored = readDescription(sha256);
  if (stored) return Promise.resolve(stored);
  const running = inflight().get(sha256);
  if (running) return running;
  const failedAt = failures().get(sha256);
  if (failedAt && !options.retryFailed && Date.now() - failedAt < RETRY_AFTER_MS) return Promise.resolve(null);
  if (!claudeOneShotAvailable()) return Promise.resolve(null);

  const promise = claudeOneShot({ prompt: describeTask(image.kind), image: image.file, model: visionModel(), signal })
    .then((result) => {
      const description: ImageDescription = {
        sha256,
        kind: image.kind,
        text: result.text.replace(/\s+\n/g, "\n").trim(),
        model: result.model,
        createdAt: new Date().toISOString(),
        source: mediaUrlPath(image.file),
      };
      writeDescription(description);
      failures().delete(sha256);
      return description;
    })
    .catch((error) => {
      if (!signal.aborted) {
        failures().set(sha256, Date.now());
        console.warn("[frameboard] описание картинки:", image.file, error instanceof Error ? error.message : error);
      }
      return null;
    })
    .finally(() => inflight().delete(sha256));
  inflight().set(sha256, promise);
  return promise;
}

export interface ShotDescription {
  image: ApprovedImage;
  sha256: string | null;
  description: ImageDescription | null;
}

/** Описания утверждённых картинок кадра, которые уже есть. Ничего не запускает. */
export function shotDescriptions(episodeId: string, shotId: string): ShotDescription[] {
  return approvedImages(episodeId, shotId).map((image) => {
    const sha256 = fileSha256(image.file);
    return { image, sha256, description: sha256 ? readDescription(sha256) : null };
  });
}

/** Описать всё утверждённое в кадре, чего ещё нет (перед задачей агенту). */
export async function ensureShotDescriptions(
  episodeId: string,
  shotId: string,
  signal: AbortSignal,
): Promise<ShotDescription[]> {
  const list = approvedImages(episodeId, shotId);
  const results = await Promise.all(list.map((image) => ensureDescription(image, signal, { retryFailed: true })));
  return list.map((image, index) => ({ image, sha256: fileSha256(image.file), description: results[index] }));
}

// ---------- фоновый цикл ----------

/** Сколько картинок фоновый цикл описывает одновременно. */
const BACKGROUND_PARALLEL = 2;

/**
 * Проход цикла: утверждённые картинки текущего эпизода без описания. Не больше
 * BACKGROUND_PARALLEL сразу; остальные — на следующих проходах.
 */
export function describePendingImages(): void {
  if (process.env.FRAMEBOARD_DESCRIBE === "off") return;
  if (!claudeOneShotAvailable()) return;
  const episodeId = readCurrentEpisodeId();
  if (!episodeId) return;
  for (const shotId of listShotIds(episodeId)) {
    for (const image of approvedImages(episodeId, shotId)) {
      if (inflight().size >= BACKGROUND_PARALLEL) return;
      const sha256 = fileSha256(image.file);
      if (!sha256 || readDescription(sha256) || inflight().has(sha256)) continue;
      void ensureDescription(image, new AbortController().signal);
    }
  }
}

/** Фоновый цикл: новое в approve текущего эпизода описывается само, без кнопки. */
export function startDescriptionLoop(): void {
  registerLoop("image-descriptions", 20_000, describePendingImages);
}

/** Этапы с описаниями: те, где важно, что на картинках на самом деле. */
export function stageUsesContext(stageId: StageId): boolean {
  return CONTEXT_STAGES.includes(stageId);
}
