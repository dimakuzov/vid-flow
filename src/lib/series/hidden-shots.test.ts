// Снятая галка прячет кадр из таблицы и не удаляет его папку.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-hidden-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import { readHiddenShotIds, setShotHidden } from "./hidden-shots";
import { createEpisode, shotDir, writeCurrentEpisodeId } from "./paths";
import { scanSeries } from "./scanner";

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("скрытый кадр пропадает из таблицы и возвращается с тем же файлом", () => {
  const episodeId = createEpisode("e01");
  writeCurrentEpisodeId(episodeId);
  const dir = shotDir(episodeId, "s02");
  fs.mkdirSync(dir, { recursive: true });
  const shotMd = path.join(dir, "shot.md");
  fs.writeFileSync(shotMd, "# Коридор\n\n- characters: lena\n- location: hall\n");
  const picture = path.join(dir, "keep.png");
  fs.writeFileSync(picture, "png");

  setShotHidden(episodeId, "s02", true);
  assert.deepEqual(readHiddenShotIds(episodeId), ["s02"]);
  assert.deepEqual(scanSeries(episodeId).shots.map((shot) => shot.id), []);
  assert.equal(scanSeries(episodeId).hiddenShots[0]?.id, "s02");
  assert.equal(fs.readFileSync(picture, "utf8"), "png");

  setShotHidden(episodeId, "s02", false);
  assert.deepEqual(readHiddenShotIds(episodeId), []);
  assert.equal(scanSeries(episodeId).shots[0]?.title, "Коридор");
  assert.equal(fs.readFileSync(shotMd, "utf8").includes("lena"), true);
});
