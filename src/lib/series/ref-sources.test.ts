// Источники референса и копирование в refs/. Всё во временной DATA_ROOT.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-refs-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import { saveCroppedImage } from "./mutations";
import { createEpisode, ensureStageDirs, getDataRoot, shotDir, stageDir } from "./paths";
import { copyRefSources, listRefSources } from "./ref-sources";

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

function put(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG);
}

before(() => {
  createEpisode("e01");
  writeShot("s01", "# Кафе\n\n- characters: Katya, Mom\n- location: cafe\n");
  writeShot("s02", "# Улица\n\n- characters: Zoe\n- location: street\n");
  put(path.join(getDataRoot(), "characters", "Katya", "body.png"));
  put(path.join(getDataRoot(), "characters", "Mom", "face.png"));
  put(path.join(getDataRoot(), "characters", "Zoe", "body.png"));
  put(path.join(getDataRoot(), "characters", "Kitchen_old", "body.png"));
  put(path.join(getDataRoot(), "locations", "cafe", "view.png"));
  put(path.join(getDataRoot(), "references", "prop.png"));
  put(path.join(stageDir("e01", "s01", "location"), "approve", "room.png"));
  put(path.join(stageDir("e01", "s01", "location"), "output", "room-try.png"));
  put(path.join(stageDir("e01", "s01", "first_frame"), "output", "own.png"));
  put(path.join(stageDir("e01", "s01", "first_frame"), "approve", "own-approved.png"));
  put(path.join(stageDir("e01", "s02", "first_frame"), "approve", "next.png"));
  put(path.join(stageDir("e01", "s02", "first_frame"), "output", "skip.png"));
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("источники: персонажи кадра первыми, текущий этап не входит, чужой кадр — только approve", () => {
  const groups = listRefSources("e01", "s01", "first_frame");
  const titles = groups.map((group) => group.title);
  assert.deepEqual(titles.slice(0, 2), ["Персонажи кадра", "Остальные персонажи"]);
  assert.deepEqual(
    groups[0].files.map((file) => file.name),
    ["body.png", "face.png"],
  );
  assert.deepEqual(
    groups[0].files.map((file) => file.label),
    ["Katya", "Mom"],
  );
  assert.deepEqual(groups[1].files.map((file) => file.label), ["Zoe"]);
  assert.ok(titles.includes("Локации"));
  assert.ok(titles.includes("Общие картинки"));
  assert.ok(titles.includes("Локация этого кадра"));
  assert.equal(titles.includes("Первый кадр этого кадра"), false);

  const paths = groups.flatMap((group) => group.files.map((file) => file.path));
  assert.ok(paths.some((item) => item.endsWith("location/approve/room.png")));
  assert.ok(paths.some((item) => item.endsWith("location/output/room-try.png")));
  assert.equal(paths.some((item) => item.endsWith("first_frame/output/own.png")), false);
  assert.equal(paths.some((item) => item.endsWith("first_frame/approve/own-approved.png")), false);
  assert.ok(paths.some((item) => item.endsWith("s02/first_frame/approve/next.png")));
  assert.equal(paths.some((item) => item.endsWith("s02/first_frame/output/skip.png")), false);
  assert.equal(paths.some((item) => item.includes("Kitchen_old")), false);
});

test("копирование в refs/: имя, суффикс при совпадении, agent_touch, исходник на месте", () => {
  const source = path.join(getDataRoot(), "references", "prop.png");
  const relative = "references/prop.png";
  const first = copyRefSources({ episodeId: "e01", shotId: "s01", stageId: "first_frame", paths: [relative] });
  const second = copyRefSources({ episodeId: "e01", shotId: "s01", stageId: "first_frame", paths: [relative] });
  assert.deepEqual(first, ["prop.png"]);
  assert.deepEqual(second, ["prop_1.png"]);
  const refs = path.join(stageDir("e01", "s01", "first_frame"), "refs");
  assert.equal(fs.readFileSync(path.join(refs, "prop.png")).equals(PNG), true);
  assert.equal(fs.readFileSync(path.join(refs, "prop_1.png")).equals(PNG), true);
  assert.equal(fs.readFileSync(source).equals(PNG), true);
  const touch = JSON.parse(fs.readFileSync(path.join(stageDir("e01", "s01", "first_frame"), "agent_touch.json"), "utf8"));
  assert.equal(touch.refsTouchedByUser, true);
});

test("обрезка пишет новый файл и не трогает исходник", () => {
  const output = path.join(stageDir("e01", "s01", "first_frame"), "output");
  const source = path.join(output, "own.png");
  const before = fs.readFileSync(source);
  const cropped = Buffer.concat([PNG, Buffer.from("crop")]);
  const saved = saveCroppedImage({
    episodeId: "e01",
    shotId: "s01",
    stageId: "first_frame",
    folder: "output",
    filename: "own.png",
    bytes: cropped,
  });
  assert.equal(saved.savedAs, "own_crop.png");
  assert.equal(fs.readFileSync(source).equals(before), true);
  assert.equal(fs.readFileSync(path.join(output, "own_crop.png")).equals(cropped), true);
  const edits = JSON.parse(fs.readFileSync(path.join(output, "edits.json"), "utf8")) as {
    file: string;
    from: string;
    kind: string;
  }[];
  assert.equal(edits.at(-1)?.file, "own_crop.png");
  assert.equal(edits.at(-1)?.from, "own.png");
  assert.equal(edits.at(-1)?.kind, "crop");
});
