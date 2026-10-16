// Список персонажей кадра: меняется только строка characters в shot.md.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-characters-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
delete process.env.SERIES_ROOT;
process.env.FRAMEBOARD_LOOPS = "off";

import { createEpisode, shotDir } from "./paths";
import { readShotMeta, setShotCharacters, setShotTitle } from "./shot-meta";

test("список персонажей меняет только строку characters", () => {
  createEpisode("e01");
  const file = path.join(shotDir("e01", "s01"), "shot.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    "# Кухня\n\n- characters: lena, mom\n- location: kitchen\n\n## Summary\nЧайник.\n\n## Заметки\nСвой раздел.\n",
  );

  const names = setShotCharacters("e01", "s01", ["Lena", "vera petrovna"]);
  assert.deepEqual(names, ["lena", "vera_petrovna"]);
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^- characters: lena, vera_petrovna$/m);
  assert.match(text, /^- location: kitchen$/m);
  assert.match(text, /## Заметки\nСвой раздел\./);
  assert.deepEqual(readShotMeta("e01", "s01").characters, ["lena", "vera_petrovna"]);
  assert.equal(readShotMeta("e01", "s01").location, "kitchen");

  assert.throws(() => setShotCharacters("e01", "s01", ["лена"]), /латиница/);
});

test("название кадра меняет заголовок и не трогает остальной текст", () => {
  createEpisode("e01");
  const file = path.join(shotDir("e01", "s02"), "shot.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "# Кухня\n\n- characters: lena\n- location: kitchen\n\nЧайник на столе.\n");
  assert.equal(setShotTitle("e01", "s02", "  Кухня вечером  "), "Кухня вечером");
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^# Кухня вечером$/m);
  assert.match(text, /^- characters: lena$/m);
  assert.match(text, /Чайник на столе\./);
  assert.equal(readShotMeta("e01", "s02").title, "Кухня вечером");
  assert.throws(() => setShotTitle("e01", "s02", "   "), /пустым/);
});
