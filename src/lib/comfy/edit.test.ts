// Сборка задания правки. Claude подменён, ComfyUI не вызывается.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-edit-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
process.env.FRAMEBOARD_DESCRIBE = "off";
delete process.env.SERIES_ROOT;

import { overrideClaudeOneShot } from "../agent/claude-oneshot";
import { loadBindings } from "./binding";
import { readComfyJob } from "./queue";
import { listEditWorkflows, queueImageEdit } from "./edit";
import { createEpisode, ensureStageDirs, getComfyQueueRoot, stageDir } from "../series/paths";
import { readImageEdits } from "../series/mutations";
import { readStageStateFile } from "../series/stage-state";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

const ENGLISH =
  "Edit image 1: the same street at night. Keep EVERYTHING else exactly the same: the same camera position, angle and framing, the same objects in the same places, nothing added, nothing removed, nothing moved except the light.";

function shot(shotId: string) {
  fs.mkdirSync(path.join(stageDir("e01", shotId, "first_frame"), ".."), { recursive: true });
  ensureStageDirs("e01", shotId);
  fs.writeFileSync(
    path.join(stageDir("e01", shotId, "first_frame"), "..", "shot.md"),
    `# Кадр\n\n- characters: Katya\n- location: cafe\n`,
  );
}

after(() => {
  overrideClaudeOneShot(null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("воркфлоу правки не попадает в меню этапа", () => {
  assert.equal(listEditWorkflows().some((item) => item.id === "qwen21_image_edit"), true);
  assert.equal(loadBindings().some((item) => item.id === "qwen21_image_edit"), false);
});

test("задание правки: исходный файл, английский промпт, edits.json, исходник не тронут", async () => {
  createEpisode("e01");
  shot("s01");
  const source = path.join(stageDir("e01", "s01", "first_frame"), "output", "frame.png");
  fs.writeFileSync(source, PNG);
  const before = fs.readFileSync(source);
  let seenModel = "";
  overrideClaudeOneShot(async (request) => {
    seenModel = request.model || "";
    assert.match(request.prompt, /сделай ночь/);
    return { text: ENGLISH, usage: {}, model: request.model || "" };
  });

  const result = await queueImageEdit({
    episodeId: "e01",
    shotId: "s01",
    stageId: "first_frame",
    folder: "output",
    filename: "frame.png",
    workflowId: "qwen21_image_edit",
    text: "сделай ночь",
    signal: AbortSignal.timeout(1000),
  });

  assert.equal(seenModel, "claude-sonnet-5-5");
  assert.equal(result.savedAs, "frame_edit_v1.png");
  assert.equal(result.prompt, ENGLISH);
  assert.equal(fs.readFileSync(source).equals(before), true);

  const job = readComfyJob(result.id);
  assert.ok(job);
  assert.equal(job.status, "pending");
  assert.equal(job.workflow, "qwen21_image_edit");
  assert.equal(job.uploads?.length, 1);
  assert.equal(job.uploads?.[0].filename, "frame.png");
  assert.equal(fs.readFileSync(path.resolve(process.cwd(), job.uploads![0].path)).equals(PNG), true);
  assert.equal(job.prompt["470"].inputs.image, "frame.png");
  assert.equal(job.prompt["477"].inputs.value, ENGLISH);
  assert.equal(job.prompt["902"], undefined);
  assert.equal(job.prompt["488"].inputs["images.image_2"], undefined);
  assert.deepEqual(job.prompt["488"].inputs["images.image_1"], ["470", 0]);
  assert.equal(job.prompt["486"].inputs.switch, true);
  assert.equal(job.prompt["461"].inputs.filename_prefix, "frameboard/edit/frame_edit_v1");
  assert.equal(typeof job.prompt["485"].inputs.seed, "number");
  assert.equal(readStageStateFile("e01", "s01", "first_frame")?.phase, "comfy");

  const edits = readImageEdits("e01", "s01", "first_frame");
  assert.equal(edits.length, 1);
  assert.equal(edits[0].file, "frame_edit_v1.png");
  assert.equal(edits[0].from, "frame.png");
  assert.equal(edits[0].kind, "edit");
  assert.equal(edits[0].prompt, ENGLISH);
  assert.equal(edits[0].workflow, "qwen21_image_edit");
  assert.equal(fs.existsSync(path.join(getComfyQueueRoot(), `${result.id}.json`)), true);
});

test("без Claude задание всё равно собирается, модель не вызывается", async () => {
  overrideClaudeOneShot(null);
  shot("s02");
  const source = path.join(stageDir("e01", "s02", "first_frame"), "approve", "still.png");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, PNG);
  const result = await queueImageEdit({
    episodeId: "e01",
    shotId: "s02",
    stageId: "first_frame",
    folder: "approve",
    filename: "still.png",
    workflowId: "qwen21_image_edit",
    text: "сделай дождь",
    signal: AbortSignal.timeout(1000),
  });
  assert.match(result.prompt, /^Edit image 1: сделай дождь\./);
  assert.match(result.prompt, /Keep EVERYTHING else exactly the same/);
  const job = readComfyJob(result.id);
  assert.equal(job?.uploads?.[0].filename, "still.png");
  assert.equal(job?.prompt["470"].inputs.image, "still.png");
  assert.equal(fs.readFileSync(source).equals(PNG), true);
});
