// Полный рост в библиотеке, названный по папке (man_ptu/man_ptu_body.png), и понятная ошибка,
// когда все картинки персонажа убраны из графа кнопкой «Убрать».
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-character-body-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
delete process.env.SERIES_ROOT;
process.env.FRAMEBOARD_LOOPS = "off";

import { queueStageRun } from "../comfy/stage-run";
import { characterBaseFiles, characterBaseImage, characterFolder } from "./character-base";
import { mediaUrlPath } from "./media";
import { createEpisode, ensureStageDirs, getCharactersRoot, shotDir, stageDir } from "./paths";
import { setExcluded } from "./run-settings";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function library(name: string, files: string[]): string {
  const dir = path.join(getCharactersRoot(), name);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(dir, file), PNG);
  return dir;
}

test("библиотека: полный рост по имени папки выбирается раньше первой картинки", () => {
  const dir = library("man_ptu", ["init_00156.png", "man_ptu_body.png", "man_ptu_sheet.png"]);
  assert.equal(path.basename(characterBaseImage(dir)!), "man_ptu_body.png");
  assert.deepEqual(characterBaseFiles(dir).map((file) => path.basename(file)), ["man_ptu_body.png"]);
  // full_body.png по-прежнему главнее
  fs.writeFileSync(path.join(dir, "full_body.png"), PNG);
  assert.equal(path.basename(characterBaseImage(dir)!), "full_body.png");
});

test("библиотека: без полного роста берётся первая картинка, как раньше", () => {
  const dir = library("kolya", ["a_portrait.png", "b_other.png"]);
  assert.equal(path.basename(characterBaseImage(dir)!), "a_portrait.png");
});

test("все картинки персонажа убраны из графа: ошибка говорит про «Убрать» и «Вернуть»", () => {
  createEpisode("e01", "Серия");
  const dir = library("lena_x", ["lena_x_body.png"]);
  const shot = shotDir("e01", "s01");
  fs.mkdirSync(shot, { recursive: true });
  fs.writeFileSync(path.join(shot, "shot.md"), "# Кадр\n\n- characters: lena_x\n- location: kitchen\n");
  ensureStageDirs("e01", "s01");
  fs.writeFileSync(path.join(stageDir("e01", "s01", "characters"), "prompt.md"), "## lena_x\nChange the clothes in image 1 to a white shirt.\n");
  assert.ok(characterFolder("lena_x"));

  const file = mediaUrlPath(path.join(dir, "lena_x_body.png"))!;
  setExcluded("e01", "s01", "characters", file, true);
  assert.throws(() => queueStageRun("e01", "s01", "characters"), /every picture of lena_x is out of the graph \(lena_x_body\.png\)/);

  setExcluded("e01", "s01", "characters", file, false);
  assert.doesNotThrow(() => queueStageRun("e01", "s01", "characters"));
});

test("нет ни одной картинки: прежняя ошибка про папку", () => {
  createEpisode("e01", "Серия");
  fs.mkdirSync(path.join(getCharactersRoot(), "empty_one"), { recursive: true });
  const shot = shotDir("e01", "s02");
  fs.mkdirSync(shot, { recursive: true });
  fs.writeFileSync(path.join(shot, "shot.md"), "# Кадр\n\n- characters: empty_one\n- location: kitchen\n");
  ensureStageDirs("e01", "s02");
  fs.writeFileSync(path.join(stageDir("e01", "s02", "characters"), "prompt.md"), "## empty_one\nChange the clothes in image 1 to a white shirt.\n");
  assert.throws(() => queueStageRun("e01", "s02", "characters"), /no base for empty_one: put a picture in data\/characters\/empty_one\//);
});
