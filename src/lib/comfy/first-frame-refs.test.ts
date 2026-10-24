// Первый кадр: референсы пользователя из refs/ уходят в граф, лица дальних персонажей — после них.
// Дальность и подписи файлов доска дописывает к сообщению агенту. Данные — во временной DATA_ROOT.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-ff-refs-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import { renderGraphImages } from "../agent/task";
import type { StageId } from "../series/constants";
import { createEpisode, ensureStageDirs, getCharactersRoot, shotDir, stageDir } from "../series/paths";
import { framingBlock, readBackView, setBackView, setFraming, setRefNote } from "../series/first-frame-settings";
import { setExcluded } from "../series/run-settings";
import { buildPrompt, libraryFaceSheet, stageBindings } from "./binding";

const EP = "e01";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const WORKFLOW = "first_frame_compositing";

function put(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG);
}

function shot(shotId: string, characters: string[], refs: string[] = []) {
  fs.mkdirSync(shotDir(EP, shotId), { recursive: true });
  fs.writeFileSync(
    path.join(shotDir(EP, shotId), "shot.md"),
    `# ${shotId}\n\n- characters: ${characters.join(", ")}\n- location: road\n`,
  );
  ensureStageDirs(EP, shotId);
  put(path.join(stageDir(EP, shotId, "location"), "approve", "road.png"));
  for (const name of characters) put(path.join(stageDir(EP, shotId, "characters"), "approve", `${name}_${shotId}.png`));
  for (const name of refs) put(path.join(stageDir(EP, shotId, "first_frame"), "refs", name));
  fs.writeFileSync(path.join(stageDir(EP, shotId, "first_frame"), "prompt.md"), "character1 is image 2. Add character1.");
}

/** Имена файлов в слотах 902…906 по порядку (image 2…6). */
function slots(shotId: string): string[] {
  const loaded = stageBindings("first_frame" as StageId).find((item) => item.id === WORKFLOW)!;
  assert.equal(loaded.error, null);
  const { prompt } = buildPrompt(loaded.binding!, structuredClone(loaded.graph!), {
    episodeId: EP,
    shotId,
    stageId: "first_frame",
  });
  return ["902", "903", "904", "905", "906"].map((node) => prompt[node]?.inputs.image).filter(Boolean) as string[];
}

before(() => {
  createEpisode(EP);
  const root = getCharactersRoot();
  put(path.join(root, "Lena", "portret.png"));
  put(path.join(root, "Misha", "Misha_face.png"));
  put(path.join(root, "Ivan", "ivan_sheet.png"));
  put(path.join(root, "Katya", "katya_face_sheet.png"));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("референс из refs/ уходит в граф после лица, файлы персонажа в refs/ — нет", () => {
  shot("s01", ["lena"], ["helmet.jpg", "lena_face.png", "lena_base.png"]);
  setFraming(EP, "s01", "lena", "waist");
  assert.deepEqual(slots("s01"), ["lena_s01.png", "s01_face0.png", "s01_ref0.jpg"]);
  const images = renderGraphImages(EP, "s01", "first_frame", WORKFLOW);
  assert.match(images, /image 3: character1 face/);
  assert.match(images, /image 4: User references \(helmet\.jpg\)/);
});

test("убранный кнопкой «Убрать» референс в граф не идёт", () => {
  shot("s02", ["lena"], ["helmet.jpg", "bike.jpg"]);
  setFraming(EP, "s02", "lena", "waist");
  setExcluded(EP, "s02", "first_frame", `episodes/${EP}/shots/s02/first_frame/refs/bike.jpg`, true);
  assert.deepEqual(slots("s02"), ["lena_s02.png", "s02_face0.png", "s02_ref0.jpg"]);
});

test("лицо дальнего персонажа — после референсов, ближнего — до", () => {
  shot("s03", ["lena", "misha"], ["helmet.jpg"]);
  // Оба близко: оба лица до референса.
  setFraming(EP, "s03", "lena", "waist");
  setFraming(EP, "s03", "misha", "waist");
  assert.deepEqual(slots("s03"), ["lena_s03.png", "misha_s03.png", "s03_face0.png", "s03_face1.png", "s03_ref0.jpg"]);
  setFraming(EP, "s03", "misha", "background");
  assert.deepEqual(slots("s03"), [
    "lena_s03.png",
    "misha_s03.png",
    "s03_face0.png",
    "s03_ref0.jpg",
    "s03_farface0.png",
  ]);
  const images = renderGraphImages(EP, "s03", "first_frame", WORKFLOW);
  assert.match(images, /image 6: character2 face \(misha in the task/);
});

test("мест не хватает: лицо дальнего персонажа уступает референсам", () => {
  shot("s04", ["lena", "misha"], ["a.jpg", "b.jpg"]);
  setFraming(EP, "s04", "lena", "face");
  setFraming(EP, "s04", "misha", "full");
  assert.deepEqual(slots("s04"), ["lena_s04.png", "misha_s04.png", "s04_face0.png", "s04_ref0.jpg", "s04_ref1.jpg"]);
  assert.match(renderGraphImages(EP, "s04", "first_frame", WORKFLOW), /Not sent.*Misha_face\.png/);
});

test("агенту: дальность и подписи референсов отдельным блоком задания", () => {
  shot("s05", ["lena", "misha"], ["helmet.jpg", "old.jpg"]);
  // Не выбрано на доске — план из текста кадра, здесь его нет: в полный рост. Пустых значений нет.
  assert.match(framingBlock(EP, "s05"), /^## Distance from the camera[^\n]*\n\n- lena: full figure.*\n- misha: full figure/);
  setFraming(EP, "s05", "lena", "face");
  setRefNote(EP, "s05", "helmet.jpg", "шлем Лены");
  setRefNote(EP, "s05", "old.jpg", "старый шлем");
  setExcluded(EP, "s05", "first_frame", `episodes/${EP}/shots/s05/first_frame/refs/old.jpg`, true);
  const text = framingBlock(EP, "s05");
  assert.match(text, /- lena: face close-up: the face is about three quarters of the frame width, the top of the head near the top edge/);
  assert.match(text, /- misha: full figure: head to feet in the frame; set the height by an object/);
  assert.match(text, /## What the user's reference files are[^\n]*\n\n- helmet\.jpg: шлем Лены/);
  assert.doesNotMatch(text, /old\.jpg/);
});

test("крупный план у двоих — одна строка «вместе», а не три четверти ширины на каждого", () => {
  shot("s07", ["lena", "misha"]);
  setFraming(EP, "s07", "lena", "face");
  setFraming(EP, "s07", "misha", "face");
  const text = framingBlock(EP, "s07");
  assert.match(text, /- lena: face close-up together with the others marked so: their faces side by side fill the whole frame/);
  assert.match(text, /- misha: face close-up together/);
  assert.doesNotMatch(text, /three quarters of the frame width/);
});

test("спиной: портрет не идёт в граф, агент получает «seen from behind»", () => {
  shot("s08", ["lena", "misha"]);
  setFraming(EP, "s08", "lena", "waist");
  setFraming(EP, "s08", "misha", "waist");
  assert.deepEqual(slots("s08"), ["lena_s08.png", "misha_s08.png", "s08_face0.png", "s08_face1.png"]);
  setBackView(EP, "s08", "lena", true);
  // Лицо Лены не идёт; портрет Миши занимает её место в ряду.
  assert.deepEqual(slots("s08"), ["lena_s08.png", "misha_s08.png", "s08_face0.png"]);
  assert.match(renderGraphImages(EP, "s08", "first_frame", WORKFLOW), /image 4: character2 face \(misha in the task/);
  assert.match(framingBlock(EP, "s08"), /- lena: seen from behind, the face hidden; waist up/);
  setBackView(EP, "s08", "lena", false);
  assert.equal(slots("s08").length, 4);
});

test("спиной по тексту кадра: только кадр с одним персонажем и пока отметок на доске нет", () => {
  shot("s09", ["lena"]);
  fs.appendFileSync(path.join(shotDir(EP, "s09"), "shot.md"), "\n## Summary\nЛена стоит спиной к нам у окна.\n");
  assert.deepEqual([...readBackView(EP, "s09")], ["lena"]);
  setBackView(EP, "s09", "lena", false);
  // Снятая на доске отметка сильнее текста.
  assert.deepEqual([...readBackView(EP, "s09")], []);
  shot("s10", ["lena", "misha"]);
  fs.appendFileSync(path.join(shotDir(EP, "s10"), "shot.md"), "\n## Summary\nЛена стоит спиной, Миша смотрит на неё.\n");
  assert.deepEqual([...readBackView(EP, "s10")], []);
});

test("дальность и подпись: только персонажи кадра, известные значения и файлы из refs/", () => {
  shot("s06", ["lena"], ["helmet.jpg"]);
  assert.throws(() => setFraming(EP, "s06", "ivan", "face"), /нет в этом кадре/);
  assert.throws(() => setFraming(EP, "s06", "lena", "huge"), /Неизвестная дальность/);
  assert.throws(() => setRefNote(EP, "s06", "../x.png", "x"), /имя файла/);
  assert.throws(() => setRefNote(EP, "s06", "nope.png", "x"), /нет в refs/);
  setFraming(EP, "s06", "lena", "waist");
  setFraming(EP, "s06", "lena", null);
  setRefNote(EP, "s06", "helmet.jpg", "  ");
  const settings = JSON.parse(fs.readFileSync(path.join(stageDir(EP, "s06", "first_frame"), "run_settings.json"), "utf8"));
  assert.equal(settings.framing, undefined);
  assert.equal(settings.refNotes, undefined);
});

test("лист лица в библиотеке: `{имя}_face_sheet` и `{имя}_sheet`", () => {
  assert.equal(path.basename(libraryFaceSheet("ivan")!), "ivan_sheet.png");
  assert.equal(path.basename(libraryFaceSheet("katya")!), "katya_face_sheet.png");
  assert.equal(libraryFaceSheet("misha"), null);
});
