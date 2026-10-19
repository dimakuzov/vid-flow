// LTX 2.5 на эскизе видео: вариант в меню, первый кадр, промпт, длительность, seed и имя файла.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-ltx-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import { createEpisode, ensureStageDirs, shotDir, stageDir } from "../series/paths";
import { writeRunSettings } from "../series/run-settings";
import { buildPrompt, stageBindings } from "./binding";
import { listWorkflowChoices } from "./workflows";

const EP = "e01";

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("LTX 2.5: на эскизе по умолчанию, собирает граф от первого кадра", () => {
  createEpisode(EP);
  fs.mkdirSync(shotDir(EP, "s01"), { recursive: true });
  fs.writeFileSync(path.join(shotDir(EP, "s01"), "shot.md"), "# s01\n\n- characters: lena\n- location: arch\n");
  ensureStageDirs(EP, "s01");
  const start = path.join(stageDir(EP, "s01", "first_frame"), "approve", "s01_first.png");
  fs.mkdirSync(path.dirname(start), { recursive: true });
  fs.writeFileSync(start, Buffer.from("89504e470d0a1a0a", "hex"));
  fs.writeFileSync(
    path.join(stageDir(EP, "s01", "video_preview"), "prompt.md"),
    "use image as the first frame. The young woman runs away from the camera. Static camera.\n",
  );

  const choices = listWorkflowChoices(EP, "s01", "video_preview");
  const ltx = choices.find((choice) => choice.id === "video_ltx");
  assert.ok(ltx?.available, JSON.stringify(ltx?.missing));
  assert.equal(choices.find((choice) => choice.isDefault)?.id, "video_ltx", "по умолчанию LTX");

  writeRunSettings(EP, "s01", "video_preview", { workflow: "video_ltx", durationSec: 6 });
  const loaded = stageBindings("video_preview").find((item) => item.id === "video_ltx")!;
  assert.equal(loaded.error, null);
  const { prompt, uploads } = buildPrompt(loaded.binding!, structuredClone(loaded.graph!), {
    episodeId: EP,
    shotId: "s01",
    stageId: "video_preview",
    random: () => 7,
  });
  assert.equal(prompt["395"].inputs.image, "s01_start.png");
  assert.deepEqual(uploads.map((item) => path.basename(item.path)), ["s01_first.png"]);
  assert.match(String(prompt["398:376"].inputs.value), /^use image as the first frame\. The young woman runs away/);
  assert.equal(prompt["398:362"].inputs.value, 6);
  assert.equal(prompt["398:339"].inputs.noise_seed, 7);
  assert.equal(prompt["75"].inputs.filename_prefix, "frameboard/video/s01_ltx");
});
