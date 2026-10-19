// «Подготовить кадр» пишет в один кадр то, что разметка пишет всем: людей, место, реплики, длительность, действие.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-prepare-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import { createEpisode, shotDir } from "./paths";
import { readRunSettings } from "./run-settings";
import { readShotFragment, readShotMeta } from "./shot-meta";
import { applyPreparedShot } from "./shot-prepare";
import { readShotSpeech } from "./speech";

test("подготовка одного кадра не меняет его id и имя и не затирает текст карточки", () => {
  const episodeId = createEpisode("e01");
  const file = path.join(shotDir(episodeId, "s04"), "shot.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "# Ночной двор\n\n- characters: \n- location: \n");
  fs.writeFileSync(path.join(shotDir(episodeId, "s04"), "fragment.md"), "Лена выходит во двор.\nЛена: Я дома.\n");

  applyPreparedShot(
    episodeId,
    "s04",
    "## s01 Чужое имя\n- characters: lena\n- location: night_yard\n- duration: 6\n- speech: Лена: Я дома.\nЛена выходит во двор.\n",
  );

  const meta = readShotMeta(episodeId, "s04");
  assert.equal(meta.title, "Ночной двор");
  assert.deepEqual(meta.characters, ["lena"]);
  assert.equal(meta.location, "night_yard");
  assert.equal(meta.summary, "Лена выходит во двор.");
  assert.equal(readShotSpeech(episodeId, "s04"), "Лена: Я дома.\n");
  assert.equal(readRunSettings(episodeId, "s04", "video_preview").durationSec, 6);
  assert.match(readShotFragment(episodeId, "s04") ?? "", /Лена выходит во двор/);
  assert.equal(fs.existsSync(shotDir(episodeId, "s01")), false);
});
