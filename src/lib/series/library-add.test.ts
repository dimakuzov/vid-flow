// Картинки этапа ↔ библиотеки персонажей и локаций.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-library-add-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
delete process.env.SERIES_ROOT;
process.env.FRAMEBOARD_LOOPS = "off";

import { addImageToCharacterStyled, addImageToLocation, copyStyledToApprove, listStyledImages } from "./library-add";
import { createEpisode, ensureStageDirs, shotDir, stageDir } from "./paths";

function setup() {
  createEpisode("e01");
  const shot = shotDir("e01", "s01");
  fs.mkdirSync(shot, { recursive: true });
  fs.writeFileSync(path.join(shot, "shot.md"), "# Кафе\n\n- characters: lena\n- location: cafe\n");
  ensureStageDirs("e01", "s01");
  for (const stage of ["characters", "location"] as const) {
    for (const folder of ["output", "approve"]) {
      fs.mkdirSync(path.join(stageDir("e01", "s01", stage), folder), { recursive: true });
    }
  }
  fs.mkdirSync(path.join(tmp, "characters", "lena"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "locations", "cafe"), { recursive: true });
}

test("картинка персонажа уходит в styled/, второй раз под новым именем", () => {
  setup();
  const source = path.join(stageDir("e01", "s01", "characters"), "output", "lena_s01.png");
  fs.writeFileSync(source, "one");
  const first = addImageToCharacterStyled({ episodeId: "e01", shotId: "s01", folder: "output", filename: "lena_s01.png", character: "Lena" });
  assert.deepEqual(first, { savedAs: "lena_s01.png", character: "lena" });
  fs.writeFileSync(source, "two");
  const second = addImageToCharacterStyled({ episodeId: "e01", shotId: "s01", folder: "output", filename: "lena_s01.png", character: "lena" });
  assert.equal(second.savedAs, "lena_s01_2.png");
  const styled = path.join(tmp, "characters", "lena", "styled");
  assert.equal(fs.readFileSync(path.join(styled, "lena_s01.png"), "utf8"), "one");
  assert.equal(fs.readFileSync(path.join(styled, "lena_s01_2.png"), "utf8"), "two");
  assert.equal(fs.existsSync(source), true);
});

test("в библиотеку не берутся чужие пути, не картинки и неизвестные персонажи", () => {
  setup();
  const base = { episodeId: "e01", shotId: "s01", folder: "output", character: "lena" };
  assert.throws(() => addImageToCharacterStyled({ ...base, filename: "../x.png" }));
  assert.throws(() => addImageToCharacterStyled({ ...base, filename: "note.txt" }));
  assert.throws(() => addImageToCharacterStyled({ ...base, folder: "refs", filename: "a.png" }), /output или approve/);
  fs.writeFileSync(path.join(stageDir("e01", "s01", "characters"), "output", "a.png"), "x");
  assert.throws(() => addImageToCharacterStyled({ ...base, filename: "a.png", character: "nobody" }), /Нет персонажа/);
});

test("картинка локации уходит в папку локации кадра", () => {
  setup();
  fs.writeFileSync(path.join(stageDir("e01", "s01", "location"), "approve", "view_a.png"), "loc");
  const result = addImageToLocation({ episodeId: "e01", shotId: "s01", folder: "approve", filename: "view_a.png" });
  assert.deepEqual(result, { savedAs: "view_a.png", location: "cafe" });
  assert.equal(fs.readFileSync(path.join(tmp, "locations", "cafe", "view_a.png"), "utf8"), "loc");
});

test("из styled/ берутся картинки персонажей кадра, в approve они получают имя кадра", () => {
  setup();
  const styled = path.join(tmp, "characters", "lena", "styled");
  fs.mkdirSync(styled, { recursive: true });
  fs.writeFileSync(path.join(styled, "winter.png"), "coat");
  const listed = listStyledImages(["lena", "nobody"]);
  assert.ok(listed.every((file) => file.character === "lena"));
  const winter = listed.find((file) => file.name === "winter.png");
  assert.equal(winter?.path, "characters/lena/styled/winter.png");

  const saved = copyStyledToApprove("e01", "s01", [winter!.path]);
  assert.deepEqual(saved, ["lena_s01.png"]);
  assert.equal(fs.readFileSync(path.join(stageDir("e01", "s01", "characters"), "approve", "lena_s01.png"), "utf8"), "coat");
  assert.throws(() => copyStyledToApprove("e01", "s01", ["characters/lena/winter.png"]), /styled/);
});
