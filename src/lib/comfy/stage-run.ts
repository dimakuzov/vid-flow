import fs from "fs";
import path from "path";
import type { StageId } from "../series/constants";
import { readTextIfExists } from "../series/media";
import {
  getLocationsRoot,
  getPlaybooksRoot,
  getSeriesRoot,
  stageDir,
  toPosix,
} from "../series/paths";
import { readShotMeta } from "../series/shot-meta";
import { readStatusFile, writeStatusFile } from "../series/status";
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

function locationImage(shotId: string, locationId: string): string {
  const refs = listImages(path.join(stageDir(shotId, "location"), "refs"));
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

function queueLocation(shotId: string): ComfyJob {
  const meta = readShotMeta(shotId);
  const stagePath = stageDir(shotId, "location");
  const promptMd = readTextIfExists(path.join(stagePath, "prompt.md"));
  const notes = readTextIfExists(path.join(stagePath, "llm_notes.md"));
  if (refusesAngleGraph(`${promptMd}\n${notes}`)) {
    throw new Error(
      "В тексте кадра сказано не использовать граф ракурсов. Отдельного графа правки в playbooks нет, в очередь его не ставлю.",
    );
  }
  const text = generationText(promptMd, notes, meta.characters);
  if (!text) throw new Error("Нет текста для генерации. Напиши рекомендацию или prompt.md.");
  const spoken = /no people/i.test(text) ? text : `${text}\nSame place, no people.`;
  const image = locationImage(shotId, meta.location);
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
    prompt,
    uploads: [{ path: relativeToCwd(image), filename }],
    saveTo: relativeToCwd(path.join(stagePath, "output")),
  });
}

function queueFirstFrame(shotId: string): ComfyJob {
  const meta = readShotMeta(shotId);
  const stagePath = stageDir(shotId, "first_frame");
  const promptMd = readTextIfExists(path.join(stagePath, "prompt.md"));
  const notes = readTextIfExists(path.join(stagePath, "llm_notes.md"));
  const text = generationText(promptMd, notes, meta.characters);
  if (!text) throw new Error("Нет текста первого кадра. Напиши рекомендацию или prompt.md.");
  const locationDir = stageDir(shotId, "location");
  const locationImageFile =
    listImages(path.join(locationDir, "approve"))[0] || listImages(path.join(locationDir, "output"))[0];
  if (!locationImageFile) throw new Error("Нет утверждённой локации для первого кадра.");
  const characters = listImages(path.join(stageDir(shotId, "characters"), "approve"));
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
  prompt["477"].inputs.value = text;
  prompt["485"].inputs.seed = newSeed();
  prompt["461"].inputs.filename_prefix = `frameboard/first_frame/${shotId}_ff`;
  return enqueueComfyJob({
    id: `${shotId}-first-${Date.now()}`,
    status: "pending",
    prompt,
    uploads,
    saveTo: relativeToCwd(path.join(stagePath, "output")),
  });
}

export function queueStageRun(shotId: string, stageId: StageId): { id: string; message: string } {
  getSeriesRoot();
  let job: ComfyJob;
  if (stageId === "location") job = queueLocation(shotId);
  else if (stageId === "first_frame") job = queueFirstFrame(shotId);
  else if (stageId === "characters") {
    throw new Error(
      "Граф одежды в API-формате не лежит в playbooks, поэтому кнопка не ставит его в Comfy. Граф позы отсюда не запускаю.",
    );
  } else {
    throw new Error("Для этого этапа в playbooks/workflows/comfy нет API-графа, в очередь Comfy ставить нечего.");
  }
  if (readStatusFile(shotId, stageId).status === "waiting") {
    writeStatusFile(shotId, stageId, { status: "prep" });
  }
  startComfyQueue();
  return {
    id: job.id,
    message: `В очереди Comfy: ${job.id}. Прогон идёт там, файлы появятся в output/.`,
  };
}
