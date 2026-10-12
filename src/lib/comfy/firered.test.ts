// FireRed на локации: пункт меню, 1–3 референса, четвёртый — ошибка.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-firered-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import { getComfyQueueRoot, createEpisode, ensureStageDirs, shotDir, stageDir } from "../series/paths";
import { writeRunSettings } from "../series/run-settings";
import { setIdle } from "../series/stage-state";
import { queueStageRun } from "./stage-run";
import { listWorkflowChoices } from "./workflows";

const EP = "e01";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function refs(...names: string[]) {
  const dir = path.join(stageDir(EP, "s01", "location"), "refs");
  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) fs.writeFileSync(path.join(dir, name), PNG);
}

test("FireRed: в меню локации, 2 референса, без третьего нода image 3", () => {
  createEpisode(EP);
  fs.mkdirSync(shotDir(EP, "s01"), { recursive: true });
  fs.writeFileSync(path.join(shotDir(EP, "s01"), "shot.md"), "# s01\n\n- characters: \n- location: arch\n");
  ensureStageDirs(EP, "s01");
  refs("a_room.png", "b_lamp.png");
  fs.writeFileSync(
    path.join(stageDir(EP, "s01", "location"), "prompt.md"),
    "Build a new 9:16 view of the room in image 1. Take the lamp from image 2. Empty room, no people.\n",
  );
  writeRunSettings(EP, "s01", "location", { workflow: "location_firered" });

  const choices = listWorkflowChoices(EP, "s01", "location");
  const firered = choices.find((choice) => choice.id === "location_firered");
  assert.ok(firered?.available, JSON.stringify(firered?.missing));
  assert.equal(choices.find((choice) => choice.isDefault)?.id, "location_views");

  const queued = queueStageRun(EP, "s01", "location", { workflow: "location_firered" });
  const job = JSON.parse(fs.readFileSync(path.join(getComfyQueueRoot(), `${queued.id}.json`), "utf8"));
  assert.equal(job.prompt["143"].inputs.image, "s01_firered_0.png");
  assert.equal(job.prompt["144"].inputs.image, "s01_firered_1.png");
  assert.equal(job.prompt["145"], undefined);
  assert.equal(job.prompt["192:187"].inputs.image2[0], "144");
  assert.equal(job.prompt["192:187"].inputs.image3, undefined);
  assert.equal(job.prompt["192:188"].inputs.image3, undefined);
  assert.match(job.prompt["192:187"].inputs.prompt, /image 1/);
  assert.equal(job.prompt["9"].inputs.filename_prefix, "frameboard/location/s01_firered");
  assert.equal(job.prompt["192:195"].inputs.aspect_ratio, "9:16 (Portrait Widescreen)");
  assert.deepEqual(
    job.uploads.map((item: { filename: string }) => item.filename),
    ["s01_firered_0.png", "s01_firered_1.png"],
  );

  setIdle(EP, "s01", "location");
  refs("c_extra.png", "d_more.png");
  assert.throws(
    () => queueStageRun(EP, "s01", "location", { workflow: "location_firered" }),
    /не больше 3 референсов/,
  );
});
