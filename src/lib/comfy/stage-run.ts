import fs from "fs";
import path from "path";
import type { StageId } from "../series/constants";
import { readTextIfExists } from "../series/media";
import { getLocationsRoot, getPlaybooksRoot, stageDir, toPosix } from "../series/paths";
import { readShotMeta } from "../series/shot-meta";
import { assertStageFree, readStageStateFile, writeStageState } from "../series/stage-state";
import { enqueueComfyJob, startComfyQueue, type ComfyJob } from "./queue";

type ApiNode = { class_type: string; inputs: Record<string, unknown> };
type ApiPrompt = Record<string, ApiNode>;

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function newSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000_000_000);
}

function relativeToCwd(absolute: string): string {
  return toPosix(path.relative(process.cwd(), absolute));
}

function listImages(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => IMAGE_EXT.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => path.join(dir, name));
}

function loadApiGraph(filename: string): ApiPrompt {
  const file = path.join(getPlaybooksRoot(), "workflows", "comfy", filename);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ApiPrompt;
  return structuredClone(parsed);
}

function refusesAngleGraph(text: string): boolean {
  return /граф ракурсов не использовать|проход\s*b/i.test(text);
}

function generationText(promptMd: string, notes: string, characters: string[]): string | null {
  const note = notes.trim();
  if (note) return note;
  const namePattern = characters
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean);
  const lines = promptMd.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^(#|Собери |Локация:|Общий вид:|Правила:|Референс:|Персонажи:|V\.O\.|Audio\b)/i.test(line)) {
      continue;
    }
    if (namePattern.some((name) => new RegExp(`\\b${name}\\b`, "i").test(line))) continue;
    kept.push(line.replace(/^Действие:\s*/i, ""));
  }
  const text = kept.join("\n").trim();
  return text || null;
}

function locationImage(episodeId: string, shotId: string, locationId: string): string {
  const refs = listImages(path.join(stageDir(episodeId, shotId, "location"), "refs"));
  if (refs[0]) return refs[0];
  const root = getLocationsRoot();
  if (!fs.existsSync(root) || !locationId) {
    throw new Error("Нет картинки локации. Положи её в refs/ этого этапа.");
  }
  const folderName = fs.readdirSync(root).find((name) => name.toLowerCase() === locationId.toLowerCase());
  if (!folderName) throw new Error(`Нет папки локации ${locationId}`);
  const folder = path.join(root, folderName);
  const view = path.join(folder, "view.png");
  if (fs.existsSync(view)) return view;
  const rest = listImages(folder).filter((file) => !/copy/i.test(path.basename(file)));
  if (rest[0]) return rest[0];
  throw new Error(`В ${folderName} нет view.png`);
}

function queueLocation(episodeId: string, shotId: string): ComfyJob {
  const meta = readShotMeta(episodeId, shotId);
  const stagePath = stageDir(episodeId, shotId, "location");
  // В модель идёт только prompt.md. llm_notes.md — поле ввода рекомендации для агента.
  const promptMd = readTextIfExists(path.join(stagePath, "prompt.md"));
  if (refusesAngleGraph(promptMd)) {
    throw new Error(
      "В тексте кадра сказано не использовать граф ракурсов. Отдельного графа правки в playbooks нет, в очередь его не ставлю.",
    );
  }
  const text = generationText(promptMd, "", meta.characters);
  if (!text) {
    throw new Error("В prompt.md нет текста для генерации. Отправь рекомендацию агенту или впиши промпт сам.");
  }
  const spoken = /no people/i.test(text) ? text : `${text}\nSame place, no people.`;
  const image = locationImage(episodeId, shotId, meta.location);
  const filename = path.basename(image);
  const prompt = loadApiGraph("location_views_multiple_angles.json");
  prompt["25"].inputs.image = filename;
  for (const id of ["100", "110", "120", "130"]) prompt[id].inputs.value = spoken;
  for (const id of ["102", "112", "122", "132"]) prompt[id].inputs.seed = newSeed();
  prompt["104"].inputs.filename_prefix = `frameboard/location/${shotId}_v1_simple`;
  prompt["114"].inputs.filename_prefix = `frameboard/location/${shotId}_v2_objects`;
  prompt["124"].inputs.filename_prefix = `frameboard/location/${shotId}_v3_camera`;
  prompt["134"].inputs.filename_prefix = `frameboard/location/${shotId}_v4_camera_objects`;
  return enqueueComfyJob({
    id: `${shotId}-location-${Date.now()}`,
    status: "pending",
    episodeId,
    shotId,
    stageId: "location",
    prompt,
    uploads: [{ path: relativeToCwd(image), filename }],
    saveTo: relativeToCwd(path.join(stagePath, "output")),
  });
}

function newestImage(dir: string): string | undefined {
  const files = listImages(dir);
  if (!files.length) return undefined;
  return files
    .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].file;
}

function firstFramePrompt(notes: string, characterCount: number): string {
  const place =
    characterCount > 1
      ? "Place the person from image 2 and the person from image 3 into the location from image 1."
      : "Place the person from image 2 into the location from image 1.";
  const keep = "Keep the location from image 1 exactly as it is. Do not add any other people.";
  const extra = notes.trim();
  return extra ? `${place}\n${extra}\n${keep}` : `${place}\n${keep}`;
}

function queueFirstFrame(episodeId: string, shotId: string): ComfyJob {
  const meta = readShotMeta(episodeId, shotId);
  const stagePath = stageDir(episodeId, shotId, "first_frame");
  const promptMd = readTextIfExists(path.join(stagePath, "prompt.md"));
  const extra = generationText(promptMd, "", meta.characters) || "";
  const locationDir = stageDir(episodeId, shotId, "location");
  const locationImageFile = newestImage(path.join(locationDir, "approve"));
  if (!locationImageFile) throw new Error("Нет утверждённой локации для первого кадра.");
  const characters = listImages(path.join(stageDir(episodeId, shotId, "characters"), "approve"));
  if (!characters.length) throw new Error("Нет утверждённых персонажей для первого кадра.");
  const prompt = loadApiGraph("qwen21_character_compositing.json");
  const uploads: { path: string; filename: string }[] = [];
  function bind(nodeId: string, file: string) {
    const filename = path.basename(file);
    prompt[nodeId].inputs.image = filename;
    uploads.push({ path: relativeToCwd(file), filename });
  }
  bind("470", locationImageFile);
  bind("902", characters[0]);
  if (characters[1]) bind("903", characters[1]);
  else {
    delete prompt["903"];
    delete prompt["488"].inputs["images.image_3"];
  }
  prompt["477"].inputs.value = firstFramePrompt(extra, characters.length);
  prompt["485"].inputs.seed = newSeed();
  prompt["461"].inputs.filename_prefix = `frameboard/first_frame/${shotId}_ff`;
  return enqueueComfyJob({
    id: `${shotId}-first-${Date.now()}`,
    status: "pending",
    episodeId,
    shotId,
    stageId: "first_frame",
    prompt,
    uploads,
    saveTo: relativeToCwd(path.join(stagePath, "output")),
  });
}

export type VideoWorkflow = "i2v" | "flf";

function stripNames(text: string, characters: string[]): string {
  let next = text;
  for (const name of [...characters].sort((a, b) => b.length - a.length)) {
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "the person");
  }
  return next.replace(/[ \t]{2,}/g, " ").trim();
}

function videoPrompt(raw: string, characters: string[]): string {
  const body = stripNames(raw, characters);
  const hasCamera = /\b(camera|shot|static|pan|dolly|zoom|трек|камер)\b/i.test(body);
  const hasTail = /realistic, natural movement/i.test(body);
  return [hasCamera ? "" : "Static shot, fixed camera.", body, hasTail ? "" : "Realistic, natural movement."]
    .filter(Boolean)
    .join(" ");
}

function secondsInText(text: string): number | null {
  const match = text.match(
    /(\d+(?:[.,]\d+)?)\s*(?:секунд\w*|сек\.?|sec\b|s\b|с(?=\s|$|[.,]))/i,
  );
  if (!match) return null;
  const seconds = Number(match[1].replace(",", "."));
  if (!Number.isFinite(seconds) || seconds < 2 || seconds > 8) return null;
  return seconds;
}

function queueVideo(
  episodeId: string,
  shotId: string,
  workflow: VideoWorkflow,
  stageId: "video_preview" | "final_render" = "video_preview",
): ComfyJob {
  const meta = readShotMeta(episodeId, shotId);
  const stagePath = stageDir(episodeId, shotId, stageId);
  const promptMd = readTextIfExists(path.join(stagePath, "prompt.md"));
  const spoken = generationText(promptMd, "", meta.characters);
  if (!spoken) {
    throw new Error("В prompt.md нет текста движения. Отправь рекомендацию агенту или впиши промпт сам.");
  }
  const start = newestImage(path.join(stageDir(episodeId, shotId, "first_frame"), "approve"));
  if (!start) throw new Error("Нет утверждённого первого кадра.");
  const prompt = loadApiGraph(
    workflow === "flf" ? "wan22_flf_sketch_turbo_api.json" : "wan22_i2v_sketch_turbo_api.json",
  );
  const uploads: { path: string; filename: string }[] = [];
  function bind(nodeId: string, file: string, filename: string) {
    prompt[nodeId].inputs.image = filename;
    uploads.push({ path: relativeToCwd(file), filename });
  }
  bind("97", start, `${shotId}_start${path.extname(start).toLowerCase() || ".png"}`);
  if (workflow === "flf") {
    const end = newestImage(path.join(stagePath, "refs"));
    if (!end) throw new Error("Для FLF положи последний кадр в refs/ этого этапа.");
    bind("98", end, `${shotId}_end${path.extname(end).toLowerCase() || ".png"}`);
  }
  const text = videoPrompt(spoken, meta.characters);
  prompt["129:93"].inputs.text = text;
  prompt["129:86"].inputs.noise_seed = newSeed();
  const seconds = secondsInText(promptMd);
  if (seconds != null) prompt["129:161"].inputs.value = seconds;
  const folder = stageId === "final_render" ? "final" : "video";
  prompt["108"].inputs.filename_prefix = `frameboard/${folder}/${shotId}_${workflow}`;
  return enqueueComfyJob({
    id: `${shotId}-${stageId}-${workflow}-${Date.now()}`,
    status: "pending",
    episodeId,
    shotId,
    stageId,
    prompt,
    uploads,
    saveTo: relativeToCwd(path.join(stagePath, "output")),
  });
}

export function queueStageRun(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  options?: { videoWorkflow?: VideoWorkflow; fromAgent?: boolean },
): { id: string; message: string } {
  // Ручной запуск закрыт, пока идёт операция. Из цикла после ответа агента — разрешён.
  if (!options?.fromAgent) assertStageFree(episodeId, shotId, stageId);
  let job: ComfyJob;
  if (stageId === "location") job = queueLocation(episodeId, shotId);
  else if (stageId === "first_frame") job = queueFirstFrame(episodeId, shotId);
  else if (stageId === "video_preview" || stageId === "final_render") {
    job = queueVideo(episodeId, shotId, options?.videoWorkflow || "i2v", stageId);
  } else {
    throw new Error(
      "Граф одежды в API-формате не лежит в playbooks, поэтому доска не ставит его в Comfy. Прогон одежды делает агент по playbooks/workflows/characters_comfy.md. Граф позы отсюда не запускаю.",
    );
  }
  const previous = readStageStateFile(episodeId, shotId, stageId);
  writeStageState(episodeId, shotId, stageId, {
    phase: "comfy",
    jobId: job.id,
    requestId: options?.fromAgent ? previous?.requestId : undefined,
  });
  startComfyQueue();
  return {
    id: job.id,
    message: `В очереди Comfy: ${job.id}. Прогон идёт там, файлы появятся в output/.`,
  };
}
