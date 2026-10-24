// Галка кадра «Строго первый кадр»: MiniMax превью и финала закрепляют утверждённый первый кадр
// на кадре 0 (MiniMaxH3AddGuide). Без галки графы такие же, как раньше.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-strict-ff-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import type { StageId } from "../series/constants";
import { renderGraphImages } from "../agent/task";
import { createEpisode, ensureStageDirs, getCharactersRoot, shotDir, stageDir } from "../series/paths";
import { readShotSettings, setStrictFirstFrame } from "../series/shot-settings";
import { buildPrompt, stageBindings } from "./binding";

const EP = "e01";

function put(file: string, bytes: Buffer = Buffer.from("89504e470d0a1a0a", "hex")) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function build(stage: StageId, workflow: string) {
  fs.writeFileSync(path.join(stageDir(EP, "s01", stage), "prompt.md"), "subject_definitions ASTROCINEMAV01K2T:\nA shot.");
  const loaded = stageBindings(stage).find((item) => item.id === workflow)!;
  assert.equal(loaded.error, null, loaded.error ?? "");
  return buildPrompt(loaded.binding!, structuredClone(loaded.graph!), {
    episodeId: EP,
    shotId: "s01",
    stageId: stage,
    random: () => 7,
  });
}

before(() => {
  createEpisode(EP);
  fs.mkdirSync(shotDir(EP, "s01"), { recursive: true });
  fs.writeFileSync(path.join(shotDir(EP, "s01"), "shot.md"), "# s01\n\n- characters: lena\n- location: street\n");
  ensureStageDirs(EP, "s01");
  put(path.join(stageDir(EP, "s01", "video_preview"), "approve", "s01_h3_00001_.mp4"), Buffer.from("not a real video"));
  put(path.join(stageDir(EP, "s01", "first_frame"), "approve", "ff.png"));
  put(path.join(stageDir(EP, "s01", "characters"), "approve", "lena_s01.png"));
  put(path.join(getCharactersRoot(), "Lena", "Lena_face.png"));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("без галки: узлов закрепления нет, гайдеры берут 121, агенту ничего лишнего", () => {
  assert.deepEqual(readShotSettings(EP, "s01"), {});
  for (const [stage, workflow] of [["video_preview", "video_minimax"], ["final_render", "final_h3_cinema"]] as const) {
    const { prompt } = build(stage, workflow);
    for (const node of ["29", "400", "401"]) assert.equal(prompt[node], undefined, `${workflow} ${node}`);
    assert.deepEqual(prompt["145"].inputs.conditioning, ["121", 0]);
    assert.deepEqual(prompt["146"].inputs.conditioning, ["121", 0]);
    assert.doesNotMatch(renderGraphImages(EP, "s01", stage, workflow), /Strict first frame/);
  }
});

test("превью с галкой: первый кадр закреплён на кадре 0, загружен один раз, номера картинок те же", () => {
  setStrictFirstFrame(EP, "s01", true);
  const { prompt, uploads } = build("video_preview", "video_minimax");
  assert.equal(prompt["29"].inputs.image, "s01_start.png");
  assert.equal(prompt["400"].class_type, "MiniMaxH3AddGuide");
  assert.equal(prompt["400"].inputs.frame_idx, 0);
  assert.deepEqual(prompt["400"].inputs.latent, ["121", 1]);
  assert.deepEqual(prompt["145"].inputs.conditioning, ["400", 0]);
  assert.equal(uploads.filter((item) => item.filename === "s01_start.png").length, 1);

  const list = renderGraphImages(EP, "s01", "video_preview", "video_minimax");
  assert.match(list, /- <Picture 1>: the approved first frame/);
  assert.match(list, /- <Picture 2>: <Subject 1> face/);
  assert.doesNotMatch(list, /<Picture 3>/);
  assert.match(list, /Strict first frame .*anchors <Picture 1> as frame 0/);
  assert.doesNotMatch(list, /Not sent/);
});

test("финал с галкой: закрепление в обоих проходах, второй — на увеличенном латенте", () => {
  setStrictFirstFrame(EP, "s01", true);
  const { prompt } = build("final_render", "final_h3_cinema");
  assert.equal(prompt["29"].inputs.image, "s01_final_first.png");
  assert.deepEqual(prompt["145"].inputs.conditioning, ["400", 0]);
  assert.deepEqual(prompt["146"].inputs.conditioning, ["401", 0]);
  assert.deepEqual(prompt["401"].inputs.latent, ["157", 0]);

  setStrictFirstFrame(EP, "s01", false);
  assert.deepEqual(readShotSettings(EP, "s01"), {});
  assert.equal(build("final_render", "final_h3_cinema").prompt["401"], undefined);
});
