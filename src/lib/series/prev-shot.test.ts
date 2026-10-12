// Копия approve предыдущего кадра. Всё во временной DATA_ROOT.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-prev-"));
process.env.DATA_ROOT = tmp;
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import { createEpisode, ensureStageDirs, shotDir, stageDir } from "./paths";
import {
  copyPickedCharacterApproves,
  copyPreviousApproveToRefs,
  copyPreviousCharacterApprove,
  listEarlierCharacterApproves,
} from "./prev-shot";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

function writeShot(shotId: string, body: string) {
  fs.mkdirSync(shotDir("e01", shotId), { recursive: true });
  fs.writeFileSync(path.join(shotDir("e01", shotId), "shot.md"), body);
  ensureStageDirs("e01", shotId);
}

before(() => {
  createEpisode("e01");
  writeShot("s01", "# Кафе\n\n- characters: Katya\n- location: cafe\n");
  writeShot("s02", "# Улица\n\n- characters: Katya\n- location: street\n");
  writeShot("s03", "# Дом\n\n- characters: Katya\n- location: home\n");
  fs.writeFileSync(path.join(stageDir("e01", "s01", "location"), "approve", "room.png"), PNG);
  fs.writeFileSync(path.join(stageDir("e01", "s01", "characters"), "approve", "Katya_s01.png"), PNG);
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("локация: approve предыдущего кадра копируется в refs/, исходник на месте", () => {
  const saved = copyPreviousApproveToRefs({ episodeId: "e01", shotId: "s02", stageId: "location" });
  assert.deepEqual(saved, ["room.png"]);
  const copy = path.join(stageDir("e01", "s02", "location"), "refs", "room.png");
  const source = path.join(stageDir("e01", "s01", "location"), "approve", "room.png");
  assert.equal(fs.readFileSync(copy).equals(PNG), true);
  assert.equal(fs.readFileSync(source).equals(PNG), true);
  assert.throws(() => copyPreviousApproveToRefs({ episodeId: "e01", shotId: "s01", stageId: "location" }), /первый кадр/);
});

test("персонажи: предыдущий approve становится файлом этого кадра", () => {
  const saved = copyPreviousCharacterApprove("e01", "s02");
  assert.deepEqual(saved, ["Katya_s02.png"]);
  const copy = path.join(stageDir("e01", "s02", "characters"), "approve", "Katya_s02.png");
  const source = path.join(stageDir("e01", "s01", "characters"), "approve", "Katya_s01.png");
  assert.equal(fs.existsSync(copy), true);
  assert.equal(fs.readFileSync(source).equals(PNG), true);
});

test("список и выбор: только кадры до этого, выбранный файл копируется", () => {
  const earlier = listEarlierCharacterApproves("e01", "s03");
  assert.deepEqual(
    earlier.map((file) => file.name),
    ["Katya_s01.png", "Katya_s02.png"],
  );
  const saved = copyPickedCharacterApproves("e01", "s03", [earlier[0].path]);
  assert.deepEqual(saved, ["Katya_s03.png"]);
  assert.equal(fs.existsSync(path.join(stageDir("e01", "s01", "characters"), "approve", "Katya_s01.png")), true);
  assert.throws(() => copyPickedCharacterApproves("e01", "s02", [earlier[1].path]), /предыдущего кадра/);
});
