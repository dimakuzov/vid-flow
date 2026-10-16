// Файлы этапа: удаление из output/ и refs/, входы этапа для страницы. Всё во временной DATA_ROOT.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-stage-files-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
delete process.env.SERIES_ROOT;
process.env.FRAMEBOARD_LOOPS = "off";

import type { StageId } from "./constants";
import { deleteStageFile } from "./mutations";
import { createEpisode, ensureStageDirs, getCharactersRoot, shotDir, stageDir } from "./paths";
import { getStageDetail } from "./scanner";
import { stageInputs } from "./stage-inputs";
import { writeStageState } from "./stage-state";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

function put(stageId: StageId, folder: string, name: string): string {
  const dir = path.join(stageDir("e01", "s01", stageId), folder);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, PNG);
  return file;
}

before(() => {
  createEpisode("e01");
  fs.mkdirSync(shotDir("e01", "s01"), { recursive: true });
  fs.writeFileSync(
    path.join(shotDir("e01", "s01"), "shot.md"),
    "# Кафе\n\n- characters: katya, mark\n- location: cafe\n",
  );
  ensureStageDirs("e01", "s01");
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("удаление из output/: файл исчезает с диска", () => {
  const file = put("location", "output", "v1.png");
  deleteStageFile("e01", "s01", "location", "output", "v1.png");
  assert.equal(fs.existsSync(file), false);
  assert.equal(getStageDetail("e01", "s01", "location").output.length, 0);
});

test("удаление из refs/: файл исчезает, agent_touch.json помечает правку пользователя", () => {
  const touch = path.join(stageDir("e01", "s01", "first_frame"), "agent_touch.json");
  fs.rmSync(touch, { force: true });
  const file = put("first_frame", "refs", "pose.png");
  deleteStageFile("e01", "s01", "first_frame", "refs", "pose.png");
  assert.equal(fs.existsSync(file), false);
  assert.equal(JSON.parse(fs.readFileSync(touch, "utf8")).refsTouchedByUser, true);
});

test("удаление: только имя файла внутри папки этапа", () => {
  const outside = put("location", "approve", "keep.png");
  for (const name of ["../approve/keep.png", "..", ".", "", "sub/x.png"]) {
    assert.throws(() => deleteStageFile("e01", "s01", "location", "output", name), /Некорректное имя/);
  }
  assert.throws(() => deleteStageFile("e01", "s01", "location", "output", "nope.png"), /не найден/);
  assert.throws(
    // @ts-expect-error approve/ удаляется через removeApprovedFile
    () => deleteStageFile("e01", "s01", "location", "approve", "keep.png"),
    /output\/ и refs\//,
  );
  assert.equal(fs.existsSync(outside), true);
});

test("занятый этап: refs/ удалять нельзя, output/ можно", () => {
  const ref = put("video_preview", "refs", "end.png");
  const out = put("video_preview", "output", "clip.png");
  writeStageState("e01", "s01", "video_preview", { phase: "agent", requestId: "r1" });
  try {
    assert.throws(() => deleteStageFile("e01", "s01", "video_preview", "refs", "end.png"), /Этап занят/);
    assert.equal(fs.existsSync(ref), true);
    deleteStageFile("e01", "s01", "video_preview", "output", "clip.png");
    assert.equal(fs.existsSync(out), false);
  } finally {
    writeStageState("e01", "s01", "video_preview", { phase: "idle" });
    fs.rmSync(ref, { force: true });
  }
});

test("входы первого кадра: утверждённые локация и персонажи", () => {
  put("location", "approve", "cafe_view.png");
  put("characters", "approve", "katya_s01.png");
  put("characters", "approve", "mark_s01.png");
  const inputs = stageInputs("e01", "s01", "first_frame");
  const location = inputs.find((input) => input.source === "approve этапа Локация");
  const people = inputs.find((input) => input.source === "approve этапа Персонажи");
  assert.ok(location && people, JSON.stringify(inputs));
  assert.deepEqual(location.files.map((file) => file.name), ["cafe_view.png"]);
  assert.deepEqual(people.files.map((file) => file.name), ["katya_s01.png", "mark_s01.png"]);
  assert.match(location.files[0].url, /^\/api\/media\/episodes\/e01\/shots\/s01\/location\/approve\//);
  assert.deepEqual(location.excluded, []);
  // Та же сводка — в StageDetail.
  assert.equal(getStageDetail("e01", "s01", "first_frame").inputs.length, inputs.length);
});

test("входы видео: утверждённый первый кадр", () => {
  const before = stageInputs("e01", "s01", "video_preview");
  assert.ok(before.every((input) => !input.files.length));
  assert.match(before[0].source, /^пусто: approve этапа Первый кадр/);

  put("first_frame", "approve", "ff.png");
  const start = stageInputs("e01", "s01", "video_preview").find(
    (input) => input.source === "approve этапа Первый кадр",
  );
  assert.deepEqual(start?.files.map((file) => file.name), ["ff.png"]);
});

test("входы персонажей: одна база и один образец одежды, остальные refs не входят", () => {
  const katya = path.join(getCharactersRoot(), "Katya");
  fs.mkdirSync(katya, { recursive: true });
  fs.writeFileSync(path.join(katya, "full_body.png"), PNG);
  fs.writeFileSync(path.join(katya, "portrait.png"), PNG);
  fs.writeFileSync(path.join(katya, "notes.png"), PNG);
  put("characters", "refs", "katya_outfit.png");
  put("characters", "refs", "katya_clothes.png");

  const inputs = stageInputs("e01", "s01", "characters");
  const base = inputs.find((input) => input.label === "Персонаж katya");
  assert.deepEqual(base?.files.map((file) => file.name), ["full_body.png"]);
  assert.equal(base?.source, "библиотека data/characters/Katya/ (full_body.png).");
  assert.match(base!.files[0].url, /^\/api\/media\/characters\/Katya\/full_body\.png/);
  const clothes = inputs.find((input) => input.label === "Одежда katya");
  assert.deepEqual(clothes?.files.map((file) => file.name), ["katya_clothes.png", "katya_outfit.png"]);
  assert.match(clothes!.source, /не больше одного референса/);

  // Старое имя базы, как у Лены: body.png. Копии не берутся. Лист не режется.
  const lena = path.join(getCharactersRoot(), "Lena");
  fs.mkdirSync(lena, { recursive: true });
  for (const name of ["body.png", "portret.png", "portret_side.png", "portret - Copy.png"]) {
    fs.writeFileSync(path.join(lena, name), PNG);
  }
  fs.writeFileSync(path.join(shotDir("e01", "s01"), "shot.md"), "# Кафе\n\n- characters: katya, lena, mark\n- location: cafe\n");
  const withLena = stageInputs("e01", "s01", "characters").find((input) => input.label === "Персонаж lena");
  assert.deepEqual(withLena?.files.map((file) => file.name), ["body.png"]);
  assert.match(withLena!.source, /Положите full_body\.png во весь рост/);

  const mark = inputs.find((input) => input.label === "Персонаж mark");
  assert.equal(mark?.files.length, 0);
  assert.equal(mark!.source, "нет базы для mark: положите картинку в data/characters/mark/");
  const markClothes = inputs.find((input) => input.label === "Одежда mark");
  assert.equal(markClothes?.files.length, 0);
  assert.match(markClothes!.source, /image 2: образец одежды/);
});
