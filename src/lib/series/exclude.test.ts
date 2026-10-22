// «Убрать из графа»: файл остаётся на диске, граф и агент его не получают. Настоящие манифесты, временная DATA_ROOT.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-exclude-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import { buildTextParts } from "../agent/task";
import type { AgentRequestFile } from "../contracts/agent-request";
import type { ImageInput } from "../contracts/graph-binding";
import { resolveImageInput, stageBindings } from "../comfy/binding";
import type { StageId } from "./constants";
import { createEpisode, ensureStageDirs, getCharactersRoot, shotDir, stageDir } from "./paths";
import { excludedFiles, setExcluded } from "./run-settings";
import { getStageDetail } from "./scanner";

const EP = "e01";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

function put(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG);
}

function input(stageId: StageId, workflow: string, name: string): ImageInput {
  return stageBindings(stageId).find((item) => item.id === workflow)!.binding!.inputs[name] as ImageInput;
}

const names = (files: string[]) => files.map((file) => path.basename(file));
const ctx = (stageId: StageId) => ({ episodeId: EP, shotId: "s01", stageId });

before(() => {
  createEpisode(EP);
  fs.mkdirSync(shotDir(EP, "s01"), { recursive: true });
  fs.writeFileSync(path.join(shotDir(EP, "s01"), "shot.md"), "# s01\n\n- characters: julia, lena\n- location: hall\n\n## Summary\nСредний план.\n");
  ensureStageDirs(EP, "s01");
  put(path.join(stageDir(EP, "s01", "location"), "approve", "hall.png"));
  put(path.join(stageDir(EP, "s01", "characters"), "approve", "julia_s01.png"));
  put(path.join(stageDir(EP, "s01", "characters"), "approve", "lena_s01.png"));
  put(path.join(stageDir(EP, "s01", "final_render"), "refs", "mine.png"));
  put(path.join(getCharactersRoot(), "Lena", "portret.png"));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("убранный персонаж не уходит в граф, файл на месте; страница показывает его как убранный", () => {
  const people = input("first_frame", "first_frame_compositing", "people");
  assert.deepEqual(names(resolveImageInput(ctx("first_frame"), people)), ["julia_s01.png", "lena_s01.png"]);

  setExcluded(EP, "s01", "first_frame", "episodes/e01/shots/s01/characters/approve/julia_s01.png", true);
  assert.deepEqual(names(resolveImageInput(ctx("first_frame"), people)), ["lena_s01.png"]);
  assert.ok(fs.existsSync(path.join(stageDir(EP, "s01", "characters"), "approve", "julia_s01.png")));
  // Только на этом этапе: у финала тот же файл по-прежнему вход.
  const final = input("final_render", "final_h3_cinema", "people");
  fs.rmSync(path.join(stageDir(EP, "s01", "final_render"), "refs", "mine.png"));
  // У Юли нет портрета — идёт утверждённый файл; у Лены — портрет из библиотеки.
  assert.deepEqual(names(resolveImageInput(ctx("final_render"), final)), ["julia_s01.png", "portret.png"]);
  put(path.join(stageDir(EP, "s01", "final_render"), "refs", "mine.png"));

  const detail = getStageDetail(EP, "s01", "first_frame");
  assert.deepEqual(detail.excluded, ["episodes/e01/shots/s01/characters/approve/julia_s01.png"]);
  const shown = detail.inputs.find((item) => item.label === people.label)!;
  assert.deepEqual(shown.files.map((file) => file.name), ["lena_s01.png"]);
  assert.deepEqual(shown.excluded.map((file) => file.name), ["julia_s01.png"]);

  setExcluded(EP, "s01", "first_frame", "episodes/e01/shots/s01/characters/approve/julia_s01.png", false);
  assert.deepEqual(names(resolveImageInput(ctx("first_frame"), people)), ["julia_s01.png", "lena_s01.png"]);
  assert.equal(excludedFiles(EP, "s01", "first_frame").size, 0);
});

test("свой лист лица на кадр убран — персонаж не пропадает, берётся его следующий вариант", () => {
  const people = input("final_render", "final_h3_cinema", "people");
  // Чужой файл в refs/ финала MiniMax не берёт: у каждого персонажа свой вариант по имени.
  assert.deepEqual(names(resolveImageInput(ctx("final_render"), people)), ["julia_s01.png", "portret.png"]);
  put(path.join(stageDir(EP, "s01", "final_render"), "refs", "lena_face_sheet.png"));
  assert.deepEqual(names(resolveImageInput(ctx("final_render"), people)), ["julia_s01.png", "lena_face_sheet.png"]);
  setExcluded(EP, "s01", "final_render", "episodes/e01/shots/s01/final_render/refs/lena_face_sheet.png", true);
  assert.deepEqual(names(resolveImageInput(ctx("final_render"), people)), ["julia_s01.png", "portret.png"]);
  assert.ok(fs.existsSync(path.join(stageDir(EP, "s01", "final_render"), "refs", "lena_face_sheet.png")));
  setExcluded(EP, "s01", "final_render", "episodes/e01/shots/s01/final_render/refs/lena_face_sheet.png", false);
  fs.rmSync(path.join(stageDir(EP, "s01", "final_render"), "refs", "lena_face_sheet.png"));
});

test("лицо из библиотеки тоже можно убрать", () => {
  fs.writeFileSync(path.join(stageDir(EP, "s01", "first_frame"), "prompt.md"), "Lena's face from image 4.");
  const faces = input("first_frame", "first_frame_compositing", "faces");
  assert.deepEqual(names(resolveImageInput(ctx("first_frame"), faces)), ["portret.png"]);
  setExcluded(EP, "s01", "first_frame", "characters/Lena/portret.png", true);
  assert.deepEqual(resolveImageInput(ctx("first_frame"), faces), []);
});

test("агент видит, что убрано; некорректный путь — ошибка", () => {
  const request = { episodeId: EP, shotId: "s01", stageId: "first_frame", message: "ближе" } as AgentRequestFile;
  const { user } = buildTextParts(request);
  assert.match(user, /## Removed from the graph by the user[\s\S]*- data\/characters\/Lena\/portret\.png/);
  assert.throws(() => setExcluded(EP, "s01", "first_frame", "../secret.png", true), /Некорректный путь/);
});
