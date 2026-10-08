// Лица для крупного плана: вход faces первого кадра включается фразой «face from image N» в prompt.md.
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

test("без фразы в промпте лица не уходят: граф как раньше", () => {
  shot("s01", ["lena"]);
  setPrompt("s01", "Place the girl from image 2 into the hall from image 1. Her face fills the frame.");
  const { prompt, uploads } = build("s01");
  assert.equal(prompt["904"], undefined);
  assert.equal(prompt["905"], undefined);
  assert.equal(prompt["903"], undefined, "второго персонажа нет");
  const encoder = prompt["488"].inputs;
  assert.deepEqual(Object.keys(encoder).filter((key) => key.startsWith("images.")), ["images.image_1", "images.image_2"]);
  assert.equal(uploads.length, 2);
});

test("один персонаж, крупный план: лицо идёт третьей картинкой", () => {
  setPrompt("s01", "Close-up portrait of the girl from image 2 in the hall from image 1. Her face from image 3 exactly.");
  const { prompt, uploads } = build("s01");
  assert.equal(prompt["904"].inputs.image, "s01_face0.png");
  assert.equal(prompt["905"], undefined);
  const keys = Object.keys(prompt["488"].inputs).filter((key) => key.startsWith("images."));
  assert.deepEqual(keys, ["images.image_1", "images.image_2", "images.image_4"], "нода сожмёт пропуск: лицо — image 3");
  assert.deepEqual(
    uploads.map((upload) => [path.basename(upload.path), upload.filename]),
    [["hall.png", "hall.png"], ["lena_s01.png", "lena_s01.png"], ["portret.png", "s01_face0.png"]],
  );
});

test("лицо из refs/{name}_face этапа важнее библиотеки; два персонажа — в порядке approve", () => {
  shot("s02", ["lena", "julia"]);
  put(path.join(stageDir(EP, "s02", "first_frame"), "refs", "lena_face.jpg"));
  setPrompt("s02", "Julia's face from image 4, Lena's face from image 5.");
  const { uploads } = build("s02");
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
});

test("агенту — номера картинок, лица отдельно и с условием", () => {
  const text = renderGraphImages(EP, "s02", "first_frame", WORKFLOW);
  assert.match(text, /- image 1: the location \(hall\.png\)/);
  assert.match(text, /- image 2: julia \(julia_s02\.png\)/);
  assert.match(text, /- image 3: lena \(lena_s02\.png\)/);
  assert.match(text, /`face from image N`[\s\S]*- image 4: julia's face \(Julia_portret\.png\)\n- image 5: lena's face \(lena_face\.jpg\)/);
  assert.equal(renderGraphImages(EP, "s02", "location", WORKFLOW), "");
});

test("страница этапа: лица видны, но помечены, пока промпт их не зовёт", () => {
  setPrompt("s01", "Medium shot of the girl from image 2.");
  const faces = stageInputs(EP, "s01", "first_frame").find((input) => input.label.startsWith("Лица"));
  assert.equal(faces?.source, "сейчас не уйдёт: prompt.md этот вход не зовёт");
  assert.deepEqual(faces?.files.map((file) => file.name), ["portret.png"]);
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
  faces.min = 1;
  assert.throws(() => validateBinding(broken, loaded.graph!), /min: 0/);
  faces.min = 0;
  faces.whenPrompt = "(";
  assert.throws(() => validateBinding(broken, loaded.graph!), /не регэксп/);
});
