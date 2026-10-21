// Название эпизода: меняется только заголовок episode.md.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-episode-title-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
delete process.env.SERIES_ROOT;
process.env.FRAMEBOARD_LOOPS = "off";

import { setEpisodeTitle } from "./episode-title";
import { createEpisode, episodeRoot } from "./paths";
import { scanSeries } from "./scanner";

test("переименование меняет заголовок episode.md и остаётся в таблице", () => {
  createEpisode("e01");
  const file = path.join(episodeRoot("e01"), "episode.md");
  fs.writeFileSync(file, "# Старое\n\nЭпизод e01.\n");

  assert.equal(setEpisodeTitle("e01", "  Новое   имя "), "Новое имя");
  assert.equal(fs.readFileSync(file, "utf8"), "# Новое имя\n\nЭпизод e01.\n");
  assert.equal(scanSeries("e01").episodeTitle, "Новое имя");
  assert.equal(scanSeries("e01").episodeId, "e01");
});

test("без episode.md заголовок создаётся, пустое имя отклоняется", () => {
  createEpisode("e02");
  fs.rmSync(path.join(episodeRoot("e02"), "episode.md"), { force: true });
  setEpisodeTitle("e02", "Имя");
  assert.equal(scanSeries("e02").episodeTitle, "Имя");
  assert.throws(() => setEpisodeTitle("e02", "   "), /пустым/);
});
