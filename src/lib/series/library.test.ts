// Библиотека локаций: список с миниатюрами, копирование общего вида в refs/. Всё во временной DATA_ROOT.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-library-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
delete process.env.SERIES_ROOT;
process.env.FRAMEBOARD_LOOPS = "off";

import { buildPrompt, resolveImageInput } from "../comfy/binding";
import { listWorkflowChoices, requireStageBinding } from "../comfy/workflows";
import { assignShotLocation, copyLocationToRefs, createLibraryLocation, listLibraryLocations } from "./library";
import { createEpisode, ensureStageDirs, getLocationsRoot, shotDir, stageDir } from "./paths";
import { readShotMeta } from "./shot-meta";

function put(folder: string, name: string, body = name): void {
  const dir = path.join(getLocationsRoot(), folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body);
}

const refsDir = () => path.join(stageDir("e01", "s01", "location"), "refs");
const touchFile = () => path.join(stageDir("e01", "s01", "location"), "agent_touch.json");

before(() => {
  createEpisode("e01");
  fs.mkdirSync(shotDir("e01", "s01"), { recursive: true });
  fs.writeFileSync(
    path.join(shotDir("e01", "s01"), "shot.md"),
    "# Кухня\n\n- characters: lena\n- location: kitchen_unknown\n\n## Summary\nЛена ставит чайник.\n\n## Заметки\nСвой раздел.\n",
  );
  ensureStageDirs("e01", "s01");

  put("Kitchen", "a_first.png");
  put("Kitchen", "view.png", "kitchen view");
  put("Kitchen", "view copy.png");
  put("Stairwell", "Stairwell copy.png");
  put("Stairwell", "2.jpg", "stairs two");
  put("Stairwell", "10.jpg");
  put("Empty", "notes.txt");
  put("_old", "view.png");
  put("Kitchen_old", "view.png");
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("список: папки по имени, миниатюра view.png или первая картинка без copy, _old пропущены", () => {
  const list = listLibraryLocations();
  assert.deepEqual(
    list.map((item) => item.id),
    ["Empty", "Kitchen", "Stairwell"],
  );
  const byId = Object.fromEntries(list.map((item) => [item.id, item.thumbnail]));
  assert.equal(byId.Kitchen, "locations/Kitchen/view.png");
  assert.equal(byId.Stairwell, "locations/Stairwell/2.jpg");
  assert.equal(byId.Empty, null);
});

test("копирование: {locationId}_view{ext} в refs/, agent_touch.json помечает правку пользователя", () => {
  const result = copyLocationToRefs({ episodeId: "e01", shotId: "s01", stageId: "location", locationId: "Kitchen" });
  assert.equal(result.savedAs, "Kitchen_view.png");
  assert.equal(result.existed, false);
  assert.equal(fs.readFileSync(path.join(refsDir(), "Kitchen_view.png"), "utf8"), "kitchen view");
  assert.equal(JSON.parse(fs.readFileSync(touchFile(), "utf8")).refsTouchedByUser, true);

  const stairs = copyLocationToRefs({ episodeId: "e01", shotId: "s01", stageId: "location", locationId: "Stairwell" });
  assert.equal(stairs.savedAs, "Stairwell_view.jpg");
  assert.equal(fs.readFileSync(path.join(refsDir(), "Stairwell_view.jpg"), "utf8"), "stairs two");
});

test("существующий файл в refs/ не затирается", () => {
  fs.writeFileSync(path.join(refsDir(), "Kitchen_view.png"), "user edit");
  fs.rmSync(touchFile());
  const result = copyLocationToRefs({ episodeId: "e01", shotId: "s01", stageId: "location", locationId: "Kitchen" });
  assert.equal(result.existed, true);
  assert.equal(fs.readFileSync(path.join(refsDir(), "Kitchen_view.png"), "utf8"), "user edit");
  assert.equal(fs.existsSync(touchFile()), false, "без нового файла отметки нет");
});

test("отказ: чужой путь, _old, папка без картинки, нет такой локации", () => {
  const copy = (locationId: string) =>
    copyLocationToRefs({ episodeId: "e01", shotId: "s01", stageId: "location", locationId });
  assert.throws(() => copy("../episodes"), /Некорректный/);
  assert.throws(() => copy("..\\..\\secret"), /Некорректный/);
  assert.throws(() => copy("Kitchen/../../x"), /Некорректный/);
  assert.throws(() => copy(""), /Некорректный/);
  assert.throws(() => copy("_old"), /Нет локации/);
  assert.throws(() => copy("Nowhere"), /Нет локации/);
  assert.throws(() => copy("Empty"), /нет картинки/);
  assert.throws(
    () => copyLocationToRefs({ episodeId: "e01", shotId: "../s01", stageId: "location", locationId: "Kitchen" }),
    /Некорректный/,
  );
});

test("«записать в кадр» меняет только строку location в shot.md", () => {
  const result = copyLocationToRefs({
    episodeId: "e01",
    shotId: "s01",
    stageId: "location",
    locationId: "Stairwell",
    writeToShot: true,
  });
  assert.equal(result.shotLocation, "Stairwell");
  const meta = readShotMeta("e01", "s01");
  assert.equal(meta.location, "Stairwell");
  assert.deepEqual(meta.characters, ["lena"]);
  const text = fs.readFileSync(path.join(shotDir("e01", "s01"), "shot.md"), "utf8");
  assert.match(text, /## Заметки\nСвой раздел\./);
});

test("смена локации кадра пишет только строку location; новая папка пустая", () => {
  const id = createLibraryLocation(" Hall ");
  assert.equal(id, "Hall");
  assert.equal(fs.existsSync(path.join(getLocationsRoot(), "Hall")), true);
  assert.equal(fs.readdirSync(path.join(getLocationsRoot(), "Hall")).length, 0);
  assert.equal(assignShotLocation("e01", "s01", "Hall"), "Hall");
  const text = fs.readFileSync(path.join(shotDir("e01", "s01"), "shot.md"), "utf8");
  assert.match(text, /^- location: Hall$/m);
  assert.match(text, /## Заметки\nСвой раздел\./);
  assert.equal(readShotMeta("e01", "s01").location, "Hall");
  assert.deepEqual(
    listLibraryLocations().map((item) => item.id),
    ["Empty", "Hall", "Kitchen", "Stairwell"],
  );

  assert.throws(() => createLibraryLocation("kitchen"), /уже есть/);
  assert.throws(() => createLibraryLocation("Kitchen_old"), /латиница/);
  assert.throws(() => createLibraryLocation("../secret"), /латиница/);
  assert.throws(() => createLibraryLocation("hall/room"), /латиница/);
  assert.throws(() => createLibraryLocation("  "), /латиница/);
  assert.throws(() => assignShotLocation("e01", "s01", "Nowhere"), /Нет локации/);
});

test("выбранная локация сразу вход графа: первый файл refs/", () => {
  const files = resolveImageInput(
    { episodeId: "e01", shotId: "s01", stageId: "location" },
    { kind: "image", from: ["refs", "library:location"], pick: "first", label: "Общий вид" },
  );
  assert.equal(path.basename(files[0]), "Kitchen_view.png");
});

test("Krea 2: без картинки — text-to-image, по умолчанию; с картинкой — референс в image1", () => {
  fs.mkdirSync(shotDir("e01", "s02"), { recursive: true });
  fs.writeFileSync(path.join(shotDir("e01", "s02"), "shot.md"), "# Новое\n\n- characters:\n- location: nowhere\n");
  ensureStageDirs("e01", "s02");
  fs.writeFileSync(
    path.join(stageDir("e01", "s02", "location"), "prompt.md"),
    "A small Soviet kitchen. Empty room, no people.\n",
  );
  const ctx = { episodeId: "e01", shotId: "s02", stageId: "location" as const, random: () => 7 };

  const choices = listWorkflowChoices("e01", "s02", "location");
  assert.equal(choices.find((item) => item.isDefault)?.id, "location_krea2");

  const { binding, graph } = requireStageBinding("location", "location_krea2");
  const bare = buildPrompt(binding, graph, ctx);
  assert.equal(bare.prompt["67"], undefined);
  assert.equal("image1" in bare.prompt["66"].inputs, false);
  assert.equal(bare.prompt["61"].inputs.value, "A small Soviet kitchen. Empty room, no people.");
  assert.equal(bare.prompt["49"].inputs.aspect_ratio, "9:16 (Portrait Widescreen)");
  assert.equal(bare.prompt["54"].inputs.seed, 7);
  assert.equal(bare.prompt["29"].inputs.filename_prefix, "frameboard/location/s02_krea2");
  assert.equal(bare.uploads.length, 0);

  copyLocationToRefs({ episodeId: "e01", shotId: "s02", stageId: "location", locationId: "Kitchen" });
  const withRef = buildPrompt(binding, graph, ctx);
  assert.equal(withRef.prompt["67"].inputs.image, "Kitchen_view.png");
  assert.deepEqual(withRef.prompt["66"].inputs.image1, ["67", 0]);
  assert.equal(listWorkflowChoices("e01", "s02", "location").find((item) => item.isDefault)?.id, "location_views");
});
