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
import { framingMessage, setFraming, setRefNote, withFramingMessage } from "../series/first-frame-settings";
import { setExcluded } from "../series/run-settings";
import { buildPrompt, stageBindings } from "./binding";

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
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("референс из refs/ уходит в граф после лица, файлы персонажа в refs/ — нет", () => {
  shot("s01", ["lena"], ["helmet.jpg", "lena_face.png", "lena_base.png"]);
  assert.deepEqual(slots("s01"), ["lena_s01.png", "s01_face0.png", "s01_ref0.jpg"]);
  const images = renderGraphImages(EP, "s01", "first_frame", WORKFLOW);
  assert.match(images, /image 3: character1 face/);
  assert.match(images, /image 4: Референсы пользователя \(helmet\.jpg\)/);
});

test("убранный кнопкой «Убрать» референс в граф не идёт", () => {
  shot("s02", ["lena"], ["helmet.jpg", "bike.jpg"]);
  setExcluded(EP, "s02", "first_frame", `episodes/${EP}/shots/s02/first_frame/refs/bike.jpg`, true);
  assert.deepEqual(slots("s02"), ["lena_s02.png", "s02_face0.png", "s02_ref0.jpg"]);
});

test("лицо дальнего персонажа — после референсов, ближнего — до", () => {
  shot("s03", ["lena", "misha"], ["helmet.jpg"]);
  // Не выбрано — как близко: оба лица до референса, как было раньше.
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

test("агенту: дальность и подписи референсов строками после сообщения", () => {
  shot("s05", ["lena", "misha"], ["helmet.jpg", "old.jpg"]);
  assert.equal(framingMessage(EP, "s05"), "");
  assert.equal(withFramingMessage(EP, "s05", "ещё раз"), "ещё раз");
  setFraming(EP, "s05", "lena", "face");
  setRefNote(EP, "s05", "helmet.jpg", "шлем Лены");
  setRefNote(EP, "s05", "old.jpg", "старый шлем");
  setExcluded(EP, "s05", "first_frame", `episodes/${EP}/shots/s05/first_frame/refs/old.jpg`, true);
  const text = withFramingMessage(EP, "s05", "крупнее");
  assert.match(text, /^крупнее\n\nDistance from the camera/);
  assert.match(text, /- lena: face close-up: the face is about three quarters of the frame width/);
  assert.doesNotMatch(text, /misha/);
  assert.match(text, /- helmet\.jpg: шлем Лены/);
  assert.doesNotMatch(text, /old\.jpg/);
  // Пустое сообщение: только строки доски.
  assert.match(withFramingMessage(EP, "s05", ""), /^Distance from the camera/);
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
