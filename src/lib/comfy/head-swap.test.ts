// Финал MiniMax H3 «замена головы»: утверждённое превью + лист лица, один персонаж, без промпта.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-head-swap-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import { createEpisode, ensureStageDirs, getCharactersRoot, shotDir, stageDir } from "../series/paths";
import { buildPrompt, stageBindings } from "./binding";
import { readComfyJob } from "./queue";
import { queueStageRun } from "./stage-run";
import { listWorkflowChoices } from "./workflows";

const EP = "e01";
const ID = "final_h3_head_swap";

function put(file: string, bytes: Buffer = Buffer.from("89504e470d0a1a0a", "hex")) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function shot(shotId: string, characters: string[]) {
  fs.mkdirSync(shotDir(EP, shotId), { recursive: true });
  fs.writeFileSync(path.join(shotDir(EP, shotId), "shot.md"), `# ${shotId}\n\n- characters: ${characters.join(", ")}\n- location: park\n`);
  ensureStageDirs(EP, shotId);
  put(path.join(stageDir(EP, shotId, "first_frame"), "approve", `${shotId}_first.png`));
  for (const name of characters) put(path.join(stageDir(EP, shotId, "characters"), "approve", `${name}_${shotId}.png`));
}

const choice = (shotId: string) => listWorkflowChoices(EP, shotId, "final_render").find((item) => item.id === ID)!;

before(() => {
  createEpisode(EP);
  put(path.join(getCharactersRoot(), "Lena", "lena_face_sheet.png"));
  put(path.join(getCharactersRoot(), "Ivan", "ivan_face.png"));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("один персонаж с листом лица и утверждённое превью — вариант доступен, не по умолчанию", () => {
  shot("s01", ["lena"]);
  assert.equal(choice("s01").available, false, "превью ещё нет");
  assert.ok(choice("s01").missing.includes("Утверждённое превью"));
  put(path.join(stageDir(EP, "s01", "video_preview"), "approve", "s01_ltx_00001_.mp4"), Buffer.from("not a real video"));
  assert.equal(choice("s01").available, true, JSON.stringify(choice("s01").missing));
  assert.notEqual(listWorkflowChoices(EP, "s01", "final_render").find((item) => item.isDefault)?.id, ID);
});

test("граф: превью в загрузку видео, лист лица в Head Reference, без промпта; в output одно видео", () => {
  const loaded = stageBindings("final_render").find((item) => item.id === ID)!;
  assert.equal(loaded.error, null, loaded.error ?? "");
  const { prompt, uploads } = buildPrompt(loaded.binding!, structuredClone(loaded.graph!), {
    episodeId: EP,
    shotId: "s01",
    stageId: "final_render",
    random: () => 7,
  });
  assert.equal(prompt["867"].inputs.video, "s01_final_src.mp4");
  assert.equal(prompt["349"].inputs.image, "s01_face_sheet.png");
  assert.equal(prompt["13"].inputs.noise_seed, 7);
  assert.equal(prompt["539"].inputs.filename_prefix, "frameboard/final/s01_head_swap");
  assert.deepEqual(uploads.map((item) => path.basename(item.path)), ["s01_ltx_00001_.mp4", "lena_face_sheet.png"]);
  const savers = Object.values(prompt).filter((node) => ["SaveVideo", "VHS_VideoCombine"].includes(node.class_type));
  assert.equal(savers.length, 1);
  // «Запустить» без prompt.md: задание собирается и встаёт в очередь.
  const { id } = queueStageRun(EP, "s01", "final_render", { workflow: ID });
  assert.equal(readComfyJob(id)?.workflow, ID);
});

test("два персонажа или нет листа лица — недоступен, видно почему", () => {
  shot("s02", ["ivan", "lena"]);
  put(path.join(stageDir(EP, "s02", "video_preview"), "approve", "s02_ltx_00001_.mp4"), Buffer.from("x"));
  assert.equal(choice("s02").available, false);
  assert.ok(choice("s02").missing.some((item) => /Утверждённые персонажи: не больше 1 \(сейчас 2\)/.test(item)), JSON.stringify(choice("s02").missing));

  shot("s03", ["ivan"]);
  put(path.join(stageDir(EP, "s03", "video_preview"), "approve", "s03_ltx_00001_.mp4"), Buffer.from("x"));
  assert.equal(choice("s03").available, false);
  assert.ok(choice("s03").missing.includes("Лист лица персонажа (face_sheet)"), "у Ивана только лицо, листа нет");
  // Свой лист на кадр в refs/ финала тоже подходит.
  put(path.join(stageDir(EP, "s03", "final_render"), "refs", "ivan_face_sheet.png"));
  assert.equal(choice("s03").available, true);
});
