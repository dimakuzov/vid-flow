// Тестовый кадр для сверки «старый stage-run.ts → манифесты» (бриф 3, задача 4).
// legacy-prompts.json снят старым кодом (до манифестов) на этих же файлах.
import fs from "node:fs";
import path from "node:path";
import type { StageId } from "../../series/constants";
import { createEpisode, ensureStageDirs, getLocationsRoot, shotDir, stageDir } from "../../series/paths";

export const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

export const EP = "t01";

export interface LegacyCase {
  name: string;
  shotId: string;
  stageId: StageId;
  workflow?: string;
  characters: string[];
  location: string;
  prompt: string;
  /** Файлы картинок: путь от папки кадра (`location/refs/view.png`) или `library:<file>` для data/locations/<location>/. */
  images: string[];
}

export const LEGACY_CASES: LegacyCase[] = [
  {
    name: "location из refs",
    shotId: "s01",
    stageId: "location",
    characters: ["katya"],
    location: "cafe",
    prompt: "Evening light over the old cafe, warm lamps on every table.",
    images: ["location/refs/view.png"],
  },
  {
    name: "location из библиотеки, no people уже есть",
    shotId: "s02",
    stageId: "location",
    characters: [],
    location: "park",
    prompt: "Empty park at dawn, no people, fog between the trees.",
    images: ["library:park_copy.png", "library:park_wide.png"],
  },
  {
    name: "first_frame, один персонаж",
    shotId: "s03",
    stageId: "first_frame",
    characters: ["katya"],
    location: "cafe",
    prompt: "She stands by the window holding a cup.",
    images: ["location/approve/cafe_s03.png", "characters/approve/katya_s03.png"],
  },
  {
    name: "first_frame, два персонажа",
    shotId: "s04",
    stageId: "first_frame",
    characters: ["katya", "anna"],
    location: "cafe",
    prompt: "They sit at the same table facing each other.",
    images: [
      "location/approve/cafe_s04.png",
      "characters/approve/anna_s04.png",
      "characters/approve/katya_s04.png",
    ],
  },
  {
    name: "first_frame, пустой prompt.md",
    shotId: "s05",
    stageId: "first_frame",
    characters: ["katya"],
    location: "cafe",
    prompt: "",
    images: ["location/approve/cafe_s05.png", "characters/approve/katya_s05.png"],
  },
  {
    name: "video i2v без камеры, 5 сек",
    shotId: "s06",
    stageId: "video_preview",
    workflow: "video_i2v",
    characters: ["katya"],
    location: "cafe",
    prompt: "The person slowly turns her head toward the door, 5 сек",
    images: ["first_frame/approve/ff_s06.png"],
  },
  {
    name: "video i2v с камерой и хвостом",
    shotId: "s07",
    stageId: "video_preview",
    workflow: "i2v",
    characters: ["katya"],
    location: "cafe",
    prompt: "Slow dolly in on the table. Realistic, natural movement.",
    images: ["first_frame/approve/ff_s07.jpg"],
  },
  {
    name: "video flf",
    shotId: "s08",
    stageId: "video_preview",
    workflow: "video_flf",
    characters: ["katya"],
    location: "cafe",
    prompt: "The person walks to the counter in 4s",
    images: ["first_frame/approve/ff_s08.png", "video_preview/refs/last.PNG"],
  },
  {
    name: "final i2v",
    shotId: "s09",
    stageId: "final_render",
    workflow: "final_i2v",
    characters: ["katya"],
    location: "cafe",
    prompt: "Steam rises from the cup.",
    images: ["first_frame/approve/ff_s09.png"],
  },
  {
    name: "final flf",
    shotId: "s10",
    stageId: "final_render",
    workflow: "flf",
    characters: ["katya"],
    location: "cafe",
    prompt: "Static camera, the person sits down.",
    images: ["first_frame/approve/ff_s10.png", "final_render/refs/end.png"],
  },
];

/** Раскладывает кадры случаев в DATA_ROOT (эпизод уже может существовать). */
export function setupLegacyCases(): void {
  createEpisode(EP);
  for (const item of LEGACY_CASES) {
    const dir = shotDir(EP, item.shotId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "shot.md"),
      `# ${item.name}\n\n- characters: ${item.characters.join(", ")}\n- location: ${item.location}\n`,
    );
    ensureStageDirs(EP, item.shotId);
    fs.writeFileSync(path.join(stageDir(EP, item.shotId, item.stageId), "prompt.md"), item.prompt);
    for (const image of item.images) {
      const file = image.startsWith("library:")
        ? path.join(getLocationsRoot(), item.location, image.slice("library:".length))
        : path.join(dir, image);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, PNG);
    }
  }
}

const SEED_FIELDS = new Set(["seed", "noise_seed"]);

type Prompt = Record<string, { class_type?: string; inputs: Record<string, unknown> }>;

/** Отличия prompt от графа: нода → null (удалена) или изменённые поля inputs ("$removed" — ключ удалён). */
function diffFromGraph(prompt: Prompt, graph: Prompt): Record<string, Record<string, unknown> | null> {
  const diff: Record<string, Record<string, unknown> | null> = {};
  for (const [id, node] of Object.entries(graph)) {
    const next = prompt[id];
    if (!next) {
      diff[id] = null;
      continue;
    }
    const changed: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(node.inputs), ...Object.keys(next.inputs)])) {
      if (!(key in next.inputs)) changed[key] = "$removed";
      else if (JSON.stringify(next.inputs[key]) !== JSON.stringify(node.inputs[key])) changed[key] = next.inputs[key];
    }
    if (Object.keys(changed).length) diff[id] = changed;
  }
  for (const id of Object.keys(prompt)) if (!(id in graph)) diff[id] = { $added: prompt[id] };
  return diff;
}

/**
 * Задание без случайного и машинного: seed → 0, пути от DATA_ROOT, prompt — отличия от графа манифеста.
 * graph — файл графа в playbooks/workflows/comfy/.
 */
export function normalizeJob(
  job: { workflow?: string; prompt: Prompt; uploads?: { path: string; filename?: string }[]; saveTo: string },
  dataRoot: string,
  graph: Prompt,
) {
  const rel = (p: string) => path.relative(dataRoot, path.resolve(process.cwd(), p)).split(path.sep).join("/");
  const prompt = structuredClone(job.prompt);
  for (const node of Object.values(prompt)) {
    for (const key of Object.keys(node.inputs)) {
      if (SEED_FIELDS.has(key) && typeof node.inputs[key] === "number") node.inputs[key] = 0;
    }
  }
  return {
    workflow: job.workflow,
    changes: diffFromGraph(prompt, graph),
    uploads: (job.uploads ?? []).map((u) => ({ path: rel(u.path), filename: u.filename })),
    saveTo: rel(job.saveTo),
  };
}
