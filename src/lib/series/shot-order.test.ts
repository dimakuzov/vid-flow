// Порядок кадров меняет последовательность в таблице и не переименовывает s02.
// Новый кадр называется s и названием, описание остаётся текстом кадра.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-order-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import { createEpisode, listShotIds, shotDir } from "./paths";
import { readShotMeta } from "./shot-meta";
import { createUserShot, userShotId, writeShotOrder } from "./shot-order";
import { latinToken } from "./latin-id";
import { scanSeries } from "./scanner";

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function makeShot(episodeId: string, id: string, title: string) {
  fs.mkdirSync(shotDir(episodeId, id), { recursive: true });
  fs.writeFileSync(path.join(shotDir(episodeId, id), "shot.md"), `# ${title}\n\n- characters: \n- location: \n`);
}

test("перестановка оставляет номера кадров и меняет только порядок", () => {
  const episodeId = createEpisode("order");
  makeShot(episodeId, "s01", "Кухня");
  makeShot(episodeId, "s02", "Улица");
  writeShotOrder(episodeId, ["s02", "s01"]);
  assert.deepEqual(listShotIds(episodeId), ["s02", "s01"]);
  assert.equal(fs.existsSync(shotDir(episodeId, "s02")), true);
  assert.equal(scanSeries(episodeId).shotOrder.join(","), "s02,s01");
  assert.equal(scanSeries(episodeId).shots[0]?.title, "Улица");
});

test("русское имя кадра не попадает в id задания", () => {
  const id = `${latinToken("sлавочка_разговор")}-location_krea2-${Date.now()}`;
  assert.equal(id.startsWith("slavochka_razgovor-"), true);
  assert.match(id, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/);
  assert.equal(userShotId("S04"), "s04");
  assert.throws(() => userShotId("04"), /начинается с s/);
});

test("новый кадр берёт id как s04 и отдельное имя", () => {
  const episodeId = createEpisode("fresh");
  makeShot(episodeId, "s01", "Кухня");
  const id = createUserShot(episodeId, "S04", "Ночной двор");
  assert.equal(id, "s04");
  assert.deepEqual(listShotIds(episodeId), ["s01", "s04"]);
  const meta = readShotMeta(episodeId, id);
  assert.equal(meta.title, "Ночной двор");
  assert.equal(fs.existsSync(shotDir(episodeId, "s02")), false);
});
