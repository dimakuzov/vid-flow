// Дальность до камеры на первом кадре: строка `- framing:` разметки сценария → run_settings при
// создании кадра; нет строки — план из текста кадра. Пустого значения («как в сценарии») нет.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-framing-"));
process.env.DATA_ROOT = tmp;
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import { applyBootstrap, parseScenario } from "./bootstrap";
import { framingFromText, parseFramingLine, readFraming, setFraming } from "./first-frame-settings";
import { lockFormattedScenario } from "./format-guard";

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("строка framing: имя: слово, имя=слово, русские слова", () => {
  assert.deepEqual(parseFramingLine("luba: full, Militsiya Officer: face"), { luba: "full", militsiya_officer: "face" });
  assert.deepEqual(parseFramingLine("lena=waist; ivan = на заднем плане"), { lena: "waist", ivan: "background" });
  assert.deepEqual(parseFramingLine("lena: крупный план, ivan: ???"), { lena: "face" });
});

test("план из текста: первое упоминание, иначе в полный рост", () => {
  assert.equal(framingFromText("Средний план в движении. Потом крупный план лица."), "waist");
  assert.equal(framingFromText("Крупный план: она смотрит."), "face");
  assert.equal(framingFromText("Она идёт по улице."), "full");
});

test("разметка → дальность при создании кадра; выбор на доске не затирается", () => {
  const scenario = [
    "# Эпизод",
    "",
    "## s01 Улица",
    "- characters: luba, officer",
    "- location: street",
    "- framing: luba: full, officer: face",
    "Средний план. Люба идёт.",
    "",
    "## s02 Двор",
    "- characters: luba",
    "Крупный план. Люба молчит.",
    "",
  ].join("\n");
  const parsed = parseScenario(scenario);
  assert.deepEqual(parsed.shots[0].framing, { luba: "full", officer: "face" });
  // Разметка доски переносит строку дальше.
  const raw = "1. Улица\nСредний план. Люба идёт.\n\n2. Двор\nКрупный план. Люба молчит.\n";
  assert.match(lockFormattedScenario(raw, scenario, parsed.shots, "Эпизод"), /- framing: luba: full, officer: face/);

  applyBootstrap({ scenario, episodeId: "e01", shotIds: ["s01", "s02"] });
  assert.deepEqual(readFraming("e01", "s01"), { luba: "full", officer: "face" });
  // Строки нет — план из текста кадра.
  assert.deepEqual(readFraming("e01", "s02"), { luba: "face" });

  setFraming("e01", "s01", "luba", "waist");
  applyBootstrap({ scenario, episodeId: "e01", shotIds: ["s01"] });
  assert.equal(readFraming("e01", "s01").luba, "waist");
});
