// MiniMax H3 (превью и финал): референсы пользователя (машина, вещь) идут в слоты после лиц.
// Свои refs/ этапа, иначе refs/ превью (у финала), иначе refs/ первого кадра.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-minimax-refs-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import type { StageId } from "../series/constants";
import { renderGraphImages } from "../agent/task";
import { createEpisode, ensureStageDirs, getCharactersRoot, shotDir, stageDir } from "../series/paths";
import { buildPrompt, stageBindings } from "./binding";

const EP = "e01";

function put(file: string, bytes: Buffer = Buffer.from("89504e470d0a1a0a", "hex")) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function refs(stage: StageId) {
  return path.join(stageDir(EP, "s01", stage), "refs");
}

function clearRefs() {
  for (const stage of ["first_frame", "video_preview", "final_render"] as StageId[]) {
    fs.rmSync(refs(stage), { recursive: true, force: true });
    fs.mkdirSync(refs(stage), { recursive: true });
  }
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

const sent = (uploads: { path: string; filename: string }[]) =>
  uploads.map((item) => [path.basename(item.path), item.filename]);

before(() => {
  createEpisode(EP);
  fs.mkdirSync(shotDir(EP, "s01"), { recursive: true });
  fs.writeFileSync(path.join(shotDir(EP, "s01"), "shot.md"), "# s01\n\n- characters: lena, ivan\n- location: street\n");
  ensureStageDirs(EP, "s01");
  put(path.join(stageDir(EP, "s01", "video_preview"), "approve", "s01_h3_00001_.mp4"), Buffer.from("not a real video"));
  put(path.join(stageDir(EP, "s01", "first_frame"), "approve", "ff.png"));
  put(path.join(stageDir(EP, "s01", "characters"), "approve", "ivan_s01.png"));
  put(path.join(stageDir(EP, "s01", "characters"), "approve", "lena_s01.png"));
  put(path.join(getCharactersRoot(), "Lena", "Lena_face.png"));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("превью: машина из refs/ первого кадра идёт после лиц", () => {
  clearRefs();
  put(path.join(refs("first_frame"), "car.jpg"));
  const { prompt, uploads } = build("video_preview", "video_minimax");
  assert.deepEqual(sent(uploads), [
    ["ff.png", "s01_start.png"],
    ["ivan_s01.png", "s01_preview_ref0.png"],
    ["Lena_face.png", "s01_preview_ref1.png"],
    ["car.jpg", "s01_preview_extra0.jpg"],
  ]);
  assert.equal(prompt["303"].inputs.image, "s01_preview_extra0.jpg");
  for (const node of ["304", "305", "306"]) assert.equal(prompt[node], undefined, node);

  const list = renderGraphImages(EP, "s01", "video_preview", "video_minimax");
  assert.match(list, /- <Picture 4>: a reference the user gave this shot, not a person.*\(car\.jpg\)/);
});

test("превью: свои refs/ важнее refs/ первого кадра, лист лица — не референс", () => {
  clearRefs();
  put(path.join(refs("first_frame"), "car.jpg"));
  put(path.join(refs("video_preview"), "bag.png"));
  put(path.join(refs("video_preview"), "lena_face_sheet.png"));
  const { uploads } = build("video_preview", "video_minimax");
  assert.deepEqual(sent(uploads).slice(1), [
    ["ivan_s01.png", "s01_preview_ref0.png"],
    ["lena_face_sheet.png", "s01_preview_ref1.png"],
    ["bag.png", "s01_preview_extra0.png"],
  ]);
});

test("финал: refs/ превью, иначе первого кадра; ролик превью не попадает в «не отправлено»", () => {
  clearRefs();
  put(path.join(refs("first_frame"), "car.jpg"));
  put(path.join(refs("video_preview"), "car_side.jpg"));
  assert.deepEqual(sent(build("final_render", "final_h3_cinema").uploads).at(-1), ["car_side.jpg", "s01_final_extra0.jpg"]);

  fs.rmSync(path.join(refs("video_preview"), "car_side.jpg"));
  assert.deepEqual(sent(build("final_render", "final_h3_cinema").uploads).at(-1), ["car.jpg", "s01_final_extra0.jpg"]);

  const list = renderGraphImages(EP, "s01", "final_render", "final_h3_cinema");
  assert.doesNotMatch(list, /Not sent/);
});

test("лица и референсы вместе — не больше 6 картинок, лишние названы", () => {
  clearRefs();
  for (const name of ["a", "b", "c", "d", "e"]) put(path.join(refs("video_preview"), `${name}.png`));
  const { uploads } = build("video_preview", "video_minimax");
  assert.equal(uploads.length, 7);
  assert.deepEqual(sent(uploads).at(-1), ["d.png", "s01_preview_extra3.png"]);
  const list = renderGraphImages(EP, "s01", "video_preview", "video_minimax");
  assert.match(list, /Not sent, the graph takes at most 7 images: e\.png\./);
});
