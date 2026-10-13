// Первый кадр: все референсы этапа (локация, персонажи, их портреты) уходят в граф подряд, image 1…6.
// Настоящий манифест и граф из playbooks/, данные — во временной DATA_ROOT.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-faces-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import { renderGraphImages } from "../agent/task";
import type { GraphBinding } from "../contracts/graph-binding";
import type { StageId } from "../series/constants";
import { createEpisode, ensureStageDirs, getCharactersRoot, shotDir, stageDir } from "../series/paths";
import { stageInputs } from "../series/stage-inputs";
import { assertModelText, buildPrompt, libraryFace, stageBindings, validateBinding } from "./binding";

const EP = "e01";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const WORKFLOW = "first_frame_compositing";

function put(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG);
}

function shot(shotId: string, characters: string[]) {
  fs.mkdirSync(shotDir(EP, shotId), { recursive: true });
  fs.writeFileSync(
    path.join(shotDir(EP, shotId), "shot.md"),
    `# ${shotId}\n\n- characters: ${characters.join(", ")}\n- location: hall\n`,
  );
  ensureStageDirs(EP, shotId);
  put(path.join(stageDir(EP, shotId, "location"), "approve", "hall.png"));
  for (const name of characters) put(path.join(stageDir(EP, shotId, "characters"), "approve", `${name}_${shotId}.png`));
}

function setPrompt(shotId: string, text: string) {
  fs.writeFileSync(path.join(stageDir(EP, shotId, "first_frame"), "prompt.md"), text);
}

function build(shotId: string) {
  const loaded = stageBindings("first_frame" as StageId).find((item) => item.id === WORKFLOW)!;
  assert.equal(loaded.error, null);
  return buildPrompt(loaded.binding!, structuredClone(loaded.graph!), { episodeId: EP, shotId, stageId: "first_frame" });
}

before(() => {
  createEpisode(EP);
  const root = getCharactersRoot();
  put(path.join(root, "Lena", "portret.png"));
  put(path.join(root, "Lena", "portret - Copy.png"));
  put(path.join(root, "Lena", "portret_side.png"));
  put(path.join(root, "Julia", "Julia_portret.png"));
  put(path.join(root, "Ivan", "portret_ivan.png"));
  put(path.join(root, "Luba", "Luba_face.png"));
  put(path.join(root, "Professor", "Professor_init_00001.png"));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("лицо в библиотеке: face/portrait/portret, с именем персонажа или без, без профиля и копий", () => {
  assert.equal(path.basename(libraryFace("lena")!), "portret.png");
  assert.equal(path.basename(libraryFace("julia")!), "Julia_portret.png");
  assert.equal(path.basename(libraryFace("ivan")!), "portret_ivan.png");
  assert.equal(path.basename(libraryFace("Luba")!), "Luba_face.png");
  assert.equal(libraryFace("professor"), null);
  assert.equal(libraryFace("nobody"), null);
});

test("персонаж без портрета: только локация и персонаж", () => {
  shot("s00", ["professor"]);
  setPrompt("s00", "Place the professor from image 2 into the hall from image 1.");
  const { prompt, uploads } = build("s00");
  for (const node of ["903", "904", "905", "906"]) assert.equal(prompt[node], undefined, node);
  const keys = Object.keys(prompt["488"].inputs).filter((key) => key.startsWith("images."));
  assert.deepEqual(keys, ["images.image_1", "images.image_2"]);
  assert.equal(uploads.length, 2);
});

test("один персонаж: портрет идёт всегда, третьей картинкой, без пропуска в номерах", () => {
  shot("s01", ["lena"]);
  setPrompt("s01", "Place the girl from image 2 into the hall from image 1. Her face fills the frame.");
  const { prompt, uploads } = build("s01");
  assert.equal(prompt["903"].inputs.image, "s01_face0.png");
  for (const node of ["904", "905", "906"]) assert.equal(prompt[node], undefined, node);
  const keys = Object.keys(prompt["488"].inputs).filter((key) => key.startsWith("images."));
  assert.deepEqual(keys, ["images.image_1", "images.image_2", "images.image_3"]);
  assert.deepEqual(
    uploads.map((upload) => [path.basename(upload.path), upload.filename]),
    [["hall.png", "hall.png"], ["lena_s01.png", "lena_s01.png"], ["portret.png", "s01_face0.png"]],
  );
});

test("портрет из refs/{name}_face этапа важнее библиотеки; два персонажа — в порядке approve", () => {
  shot("s02", ["lena", "julia"]);
  put(path.join(stageDir(EP, "s02", "first_frame"), "refs", "lena_face.jpg"));
  setPrompt("s02", "Place Julia (image 2) and Lena (image 3) into the hall from image 1.");
  const { prompt, uploads } = build("s02");
  assert.deepEqual(
    uploads.map((upload) => [path.basename(upload.path), upload.filename]),
    [
      ["hall.png", "hall.png"],
      ["julia_s02.png", "julia_s02.png"],
      ["lena_s02.png", "lena_s02.png"],
      ["Julia_portret.png", "s02_face0.png"],
      ["lena_face.jpg", "s02_face1.jpg"],
    ],
  );
  assert.equal(prompt["906"], undefined);
  assert.equal(prompt["488"].inputs["images.image_6"], undefined);
});

test("агенту — номера всех картинок и что на них", () => {
  const text = renderGraphImages(EP, "s02", "first_frame", WORKFLOW);
  assert.match(text, /- image 1: the location \(hall\.png\)/);
  assert.match(text, /- image 2: julia \(approved character[^)]*\) \(julia_s02\.png\)/);
  assert.match(text, /- image 3: lena \(approved character[^)]*\) \(lena_s02\.png\)/);
  assert.match(text, /- image 4: portrait of julia \(face reference\) \(Julia_portret\.png\)/);
  assert.match(text, /- image 5: portrait of lena \(face reference\) \(lena_face\.jpg\)/);
  assert.doesNotMatch(text, /Not sent/);
  assert.equal(renderGraphImages(EP, "s02", "location", WORKFLOW), "");
});

test("больше шести картинок: лишние портреты не уходят, агент об этом знает", () => {
  shot("s03", ["lena", "julia", "ivan"]);
  setPrompt("s03", "Place Ivan (image 2), Julia (image 3) and Lena (image 4) into the hall from image 1.");
  const { prompt, uploads } = build("s03");
  assert.deepEqual(
    uploads.map((upload) => path.basename(upload.path)),
    ["hall.png", "ivan_s03.png", "julia_s03.png", "lena_s03.png", "portret_ivan.png", "Julia_portret.png"],
  );
  assert.equal(prompt["906"].inputs.image, "s03_face1.png");
  const text = renderGraphImages(EP, "s03", "first_frame", WORKFLOW);
  assert.match(text, /- image 6: portrait of julia/);
  assert.match(text, /Not sent, the graph takes at most 6 images: portret\.png/);
});

test("страница этапа: портреты показаны как обычный вход", () => {
  const faces = stageInputs(EP, "s01", "first_frame").find((input) => input.label.startsWith("Портреты"));
  assert.notEqual(faces?.source, "сейчас не уйдёт: prompt.md этот вход не зовёт");
  assert.deepEqual(faces?.files.map((file) => file.name), ["portret.png"]);
});

test("первый кадр без персонажей: только локация, вторая картинка вырезана", () => {
  shot("s09", []);
  setPrompt("s09", "Edit image 1. Add a closed diary on the nearest table. The place stays as in image 1.");
  const built = build("s09");
  assert.equal(built.prompt["902"], undefined);
  assert.equal(built.prompt["488"].inputs["images.image_2"], undefined);
  assert.equal(built.uploads.length, 1);
  assert.match(built.uploads[0].path, /location/);
});

test("промпт с путями к файлам не уходит в модель", () => {
  assert.throws(() => assertModelText("Match the face from refs/portret - Copy.png."), /ссылается на файл/);
  assert.throws(() => assertModelText("Place Lena from shots/s10/characters/approve/x into it."), /ссылается на файл/);
  assert.throws(() => assertModelText("Use lena_s10.png as the girl."), /ссылается на файл/);
  assertModelText("Place the girl from image 2 into the canteen from image 1. Her face from image 3.");
});

test("манифест: вход с whenPrompt должен быть необязательным, whenPrompt — регэксп", () => {
  const loaded = stageBindings("first_frame" as StageId).find((item) => item.id === WORKFLOW)!;
  const broken = structuredClone(loaded.binding!) as GraphBinding;
  const faces = broken.inputs.faces as { min?: number; whenPrompt?: string };
  faces.whenPrompt = "\bface\b";
  faces.min = 1;
  assert.throws(() => validateBinding(broken, loaded.graph!), /min: 0/);
  faces.min = 0;
  faces.whenPrompt = "(";
  assert.throws(() => validateBinding(broken, loaded.graph!), /не регэксп/);
});

test("манифест: inputs слота — только входы-файлы", () => {
  const loaded = stageBindings("first_frame" as StageId).find((item) => item.id === WORKFLOW)!;
  const broken = structuredClone(loaded.binding!) as GraphBinding;
  (broken.slots[1].value as { inputs: string[] }).inputs = ["people", "text"];
  assert.throws(() => validateBinding(broken, loaded.graph!), /text не вход-файл/);
});
