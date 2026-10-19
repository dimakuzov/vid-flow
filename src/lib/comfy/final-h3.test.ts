// Финал MiniMax H3 Cinema: первый кадр — Picture 1, по картинке на персонажа, триггер ЛоРы
// первой строкой, длина превью. Настоящие манифесты и граф, данные во временной DATA_ROOT.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-final-h3-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import type { AgentRequestFile } from "../contracts/agent-request";
import { buildTextParts } from "../agent/task";
import { createEpisode, ensureStageDirs, getCharactersRoot, shotDir, stageDir } from "../series/paths";
import { buildPrompt, stageBindings } from "./binding";
import { listWorkflowChoices } from "./workflows";

const EP = "e01";
const H3 = "final_h3_cinema";

function put(file: string, bytes: Buffer = Buffer.from("89504e470d0a1a0a", "hex")) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function build(workflow: string, text: string) {
  fs.writeFileSync(path.join(stageDir(EP, "s01", "final_render"), "prompt.md"), text);
  const loaded = stageBindings("final_render").find((item) => item.id === workflow)!;
  assert.equal(loaded.error, null, loaded.error ?? "");
  return buildPrompt(loaded.binding!, structuredClone(loaded.graph!), {
    episodeId: EP,
    shotId: "s01",
    stageId: "final_render",
    random: () => 7,
  });
}

before(() => {
  createEpisode(EP);
  fs.mkdirSync(shotDir(EP, "s01"), { recursive: true });
  fs.writeFileSync(path.join(shotDir(EP, "s01"), "shot.md"), "# s01\n\n- characters: lena, ivan\n- location: hall\n");
  ensureStageDirs(EP, "s01");
  put(path.join(stageDir(EP, "s01", "video_preview"), "approve", "clip.mp4"), Buffer.from("not a real video"));
  put(path.join(stageDir(EP, "s01", "first_frame"), "approve", "ff.png"));
  put(path.join(stageDir(EP, "s01", "characters"), "approve", "ivan_s01.png"));
  put(path.join(stageDir(EP, "s01", "characters"), "approve", "lena_s01.png"));
  // У Лены есть портрет, у Ивана нет: Лена — лицом, Иван — утверждённым персонажем.
  put(path.join(getCharactersRoot(), "Lena", "Lena_face.png"));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("старых вариантов H3 нет; без реплик по умолчанию Wan", () => {
  const ids = listWorkflowChoices(EP, "s01", "final_render").map((choice) => choice.id);
  assert.ok(ids.includes(H3));
  for (const old of ["final_h3", "final_h3_768", "final_h3_768_face"]) assert.ok(!ids.includes(old), old);
  assert.equal(listWorkflowChoices(EP, "s01", "final_render").find((choice) => choice.isDefault)?.id, "final_wan_720");
});

test("H3 Cinema: Picture 1 — первый кадр, дальше по картинке на персонажа, лишние ноды убраны", () => {
  const { prompt, uploads } = build(H3, "subject_definitions ASTROCINEMAV01K2T:\n<Subject 1> is the young man defined by <Picture 2>.");
  assert.equal(prompt["28"].inputs.image, "s01_final_first.png");
  assert.equal(prompt["301"].inputs.image, "s01_final_ref0.png");
  assert.equal(prompt["302"].inputs.image, "s01_final_ref1.png");
  for (const node of ["303", "304", "305", "306"]) assert.equal(prompt[node], undefined, node);
  const refs = Object.keys(prompt["121"].inputs).filter((key) => key.startsWith("ref_images."));
  assert.deepEqual(refs, ["ref_images.ref_image_0", "ref_images.ref_image_1", "ref_images.ref_image_2"]);
  assert.deepEqual(
    uploads.map((item) => [path.basename(item.path), item.filename]),
    [
      ["ff.png", "s01_final_first.png"],
      ["ivan_s01.png", "s01_final_ref0.png"],
      ["Lena_face.png", "s01_final_ref1.png"],
    ],
  );
  assert.equal(prompt["151"].inputs.noise_seed, 7);
  assert.equal(prompt["155"].inputs.noise_seed, 7);
  assert.equal(prompt["192"].inputs.filename_prefix, "frameboard/final/s01_h3c");
  // В output уходит одно видео: промежуточные сохранения из графа пользователя убраны.
  const savers = Object.values(prompt).filter((node) => ["SaveVideo", "VHS_VideoCombine"].includes(node.class_type));
  assert.equal(savers.length, 1);
});

test("триггер ЛоРы: доска ставит его первой строкой, если агент его не написал, и не дублирует", () => {
  const without = build(H3, "<Subject 1> is the young man defined by <Picture 2>.").prompt["190"].inputs.value;
  assert.equal(without, "subject_definitions ASTROCINEMAV01K2T:\n<Subject 1> is the young man defined by <Picture 2>.");
  const written = "subject_definitions ASTROCINEMAV01K2T:\n<Subject 1> is the young man defined by <Picture 2>.";
  assert.equal(build(H3, written).prompt["190"].inputs.value, written);
});

test("один говорящий — по умолчанию H3 Cinema, двое — HeyGen; без дословной реплики H3 не запускается", () => {
  fs.writeFileSync(path.join(shotDir(EP, "s01"), "speech.md"), "Lena: It is kind of scary.\n");
  try {
    assert.equal(listWorkflowChoices(EP, "s01", "final_render").find((choice) => choice.isDefault)?.id, H3);
    assert.throws(() => build(H3, "subject_definitions ASTROCINEMAV01K2T:\nShe smiles."), /нет реплик из speech\.md/);
    const value = build(H3, "subject_definitions ASTROCINEMAV01K2T:\nShe says quietly, <d>[English] It is kind of scary.</d>").prompt["190"].inputs.value;
    assert.match(String(value), /<d>\[English\] It is kind of scary\.<\/d>/);
    fs.writeFileSync(path.join(shotDir(EP, "s01"), "speech.md"), "Lena: It is kind of scary.\nIvan: Why?\n");
    assert.equal(listWorkflowChoices(EP, "s01", "final_render").find((choice) => choice.isDefault)?.id, "final_heygen");
  } finally {
    fs.rmSync(path.join(shotDir(EP, "s01"), "speech.md"), { force: true });
  }
});

test("задача агенту: картинки как <Picture N>, люди как <Subject N>, промпт эскиза и длина", () => {
  fs.writeFileSync(path.join(stageDir(EP, "s01", "video_preview"), "prompt.md"), "Static shot. Lena eats ice cream.");
  const request = {
    episodeId: EP,
    shotId: "s01",
    stageId: "final_render",
    message: "x",
    createdAt: new Date().toISOString(),
  } as AgentRequestFile;
  fs.writeFileSync(
    path.join(stageDir(EP, "s01", "final_render"), "run_settings.json"),
    JSON.stringify({ workflow: H3 }),
  );
  const user = buildTextParts(request).user;
  assert.match(user, /## Images the graph receives \(use these names in prompt\.md\)/);
  assert.match(user, /- <Picture 1>: the approved first frame/);
  assert.match(user, /- <Picture 2>: <Subject 1> approved figure and clothes \(ivan in the task/);
  assert.match(user, /- <Picture 3>: <Subject 2> face \(lena in the task/);
  assert.match(user, /`<Subject 1> is the young woman defined by <Picture 2>`/);
  assert.match(user, /## Approved sketch prompt \(from prompt\.md этапа video_preview[^\n]*\n\nStatic shot\. Lena eats ice cream\./);
});

test("лист лица важнее одного лица; агент видит его как face sheet", () => {
  put(path.join(getCharactersRoot(), "Lena", "lena_face_sheet.png"));
  const { uploads } = build(H3, "subject_definitions ASTROCINEMAV01K2T:\n<Subject 2> is the young woman defined by <Picture 3>.");
  assert.deepEqual(
    uploads.map((item) => path.basename(item.path)),
    ["ff.png", "ivan_s01.png", "lena_face_sheet.png"],
  );
  const request = {
    episodeId: EP,
    shotId: "s01",
    stageId: "final_render",
    message: "x",
    createdAt: new Date().toISOString(),
  } as AgentRequestFile;
  assert.match(
    buildTextParts(request).user,
    /- <Picture 3>: <Subject 2> face sheet: several views of the same face \(lena in the task/,
  );
  // refs/ этапа: свой лист на кадр важнее библиотеки, остальные персонажи остаются.
  put(path.join(stageDir(EP, "s01", "final_render"), "refs", "lena_face_sheet.jpg"));
  try {
    const own = build(H3, "subject_definitions ASTROCINEMAV01K2T:\nx").uploads.map((item) => path.basename(item.path));
    assert.deepEqual(own, ["ff.png", "ivan_s01.png", "lena_face_sheet.jpg"], "свой лист Лены на кадр, Иван остаётся");
  } finally {
    fs.rmSync(path.join(stageDir(EP, "s01", "final_render"), "refs", "lena_face_sheet.jpg"));
  }
});
