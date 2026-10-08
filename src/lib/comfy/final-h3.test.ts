// Финал MiniMax H3: доска сама гарантирует фразу про @img-1/@vid-1 и указание следовать @vid-1;
// по умолчанию — 768 с face pass. Настоящие манифесты и граф, данные во временной DATA_ROOT.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-final-h3-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import { createEpisode, ensureStageDirs, shotDir, stageDir } from "../series/paths";
import { buildPrompt, stageBindings } from "./binding";
import { listWorkflowChoices } from "./workflows";

const EP = "e01";

function put(file: string, bytes: Buffer = Buffer.from("89504e470d0a1a0a", "hex")) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function creatorData(workflow: string, body: string) {
  fs.writeFileSync(path.join(stageDir(EP, "s01", "final_render"), "prompt.md"), body);
  const loaded = stageBindings("final_render").find((item) => item.id === workflow)!;
  assert.equal(loaded.error, null, loaded.error ?? "");
  const { prompt } = buildPrompt(loaded.binding!, structuredClone(loaded.graph!), {
    episodeId: EP,
    shotId: "s01",
    stageId: "final_render",
    random: () => 7,
  });
  return JSON.parse(String(prompt["1"].inputs.creator_data));
}

before(() => {
  createEpisode(EP);
  fs.mkdirSync(shotDir(EP, "s01"), { recursive: true });
  fs.writeFileSync(path.join(shotDir(EP, "s01"), "shot.md"), "# s01\n\n- characters: lena\n- location: hall\n");
  ensureStageDirs(EP, "s01");
  put(path.join(stageDir(EP, "s01", "video_preview"), "approve", "clip.mp4"), Buffer.from("not a real video"));
  put(path.join(stageDir(EP, "s01", "first_frame"), "approve", "ff.png"));
  put(path.join(stageDir(EP, "s01", "characters"), "approve", "lena_s01.png"));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("по умолчанию — финал Wan 720×1280; H3 768 с face pass — первый из H3", () => {
  const choices = listWorkflowChoices(EP, "s01", "final_render");
  assert.equal(choices.find((choice) => choice.isDefault)?.id, "final_wan_720");
  assert.equal(choices.find((choice) => choice.id.startsWith("final_h3"))?.id, "final_h3_768_face");
  const data = creatorData("final_h3_768_face", "Static shot. Lena holds her hand to her chest.");
  assert.equal(data.short_edge, 768);
  assert.equal(data.face.on, true);
});

test("Wan: эскиз 576×1024, финал Wan 720×1280 с промптом эскиза", () => {
  fs.writeFileSync(path.join(stageDir(EP, "s01", "video_preview"), "prompt.md"), "Static shot. Lena turns her head. 5 sec");
  fs.writeFileSync(path.join(stageDir(EP, "s01", "final_render"), "prompt.md"), "[Shot 1] H3 text, not for Wan.");
  const build = (stageId: "video_preview" | "final_render", workflow: string) => {
    const loaded = stageBindings(stageId).find((item) => item.id === workflow)!;
    assert.equal(loaded.error, null, loaded.error ?? "");
    return buildPrompt(loaded.binding!, structuredClone(loaded.graph!), { episodeId: EP, shotId: "s01", stageId, random: () => 7 }).prompt;
  };
  for (const workflow of ["video_i2v", "video_flf"]) {
    if (workflow === "video_flf") put(path.join(stageDir(EP, "s01", "video_preview"), "refs", "end.png"));
    const wan = build("video_preview", workflow)["129:98"].inputs;
    assert.deepEqual([wan.width, wan.height], [576, 1024], workflow);
  }
  const final = build("final_render", "final_wan_720");
  assert.deepEqual([final["129:98"].inputs.width, final["129:98"].inputs.height], [720, 1280]);
  assert.equal(final["129:93"].inputs.text, "Static shot. Lena turns her head. 5 sec");
  assert.equal(final["108"].inputs.filename_prefix, "frameboard/final/s01_wan720");
});

test("промпт без фиксированной фразы: доска ставит её в начало и указание следовать @vid-1 в конец", () => {
  for (const workflow of ["final_h3", "final_h3_768", "final_h3_768_face"]) {
    const body = creatorData(workflow, "Static shot. Lena holds her hand to her chest.").segments[0].refined.body as string;
    assert.match(body, /^The scene begins from @img-1, the same camera position.*use @vid-1 as a reference/, workflow);
    assert.match(body, /Static shot\. Lena holds her hand to her chest\.\n\nFollow @vid-1 exactly from the first frame to the last/);
  }
});

test("агент уже написал фразу и указание — доска их не дублирует", () => {
  const written =
    "[Shot 1] The scene begins from @img-1, the same camera position, the same frame, The first frame must exactly replicate @img-1. use @vid-1 as a reference, use the movements and the lighting changes from it. Lena stands still.\n\nFollow @vid-1 exactly, every movement.";
  const body = creatorData("final_h3_768_face", written).segments[0].refined.body as string;
  assert.equal(body, written);
});
