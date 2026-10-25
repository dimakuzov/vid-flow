// Разделы prompt.md, пути внутри JSON-строки, константы, ролики и длительность, проверка русского текста.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-sections-"));
process.env.DATA_ROOT = path.join(tmp, "data");
process.env.PLAYBOOKS_ROOT = path.join(tmp, "playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import type { GraphBinding, TextInput } from "../contracts/graph-binding";
import type { StageId } from "../series/constants";
import { createEpisode, ensureStageDirs, shotDir, stageDir } from "../series/paths";
import { readStageStateFile, setIdle, writeStageState } from "../series/stage-state";
import { buildPrompt, russianLine, sectionText, splitSections, validateBinding, videoDurationSeconds } from "./binding";
import { listHistoryImages } from "./client";

const EP = "e01";
const SHOT = "s01";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

/** Минимальный mp4: только атом mvhd v0 с timescale 1000 и длительностью ms. */
function mp4(ms: number): Buffer {
  const box = Buffer.alloc(8 + 100);
  box.writeUInt32BE(box.length, 0);
  box.write("mvhd", 4, "ascii");
  box.writeUInt8(0, 8); // version
  box.writeUInt32BE(1000, 8 + 4 + 8); // timescale
  box.writeUInt32BE(ms, 8 + 4 + 8 + 4); // duration
  return Buffer.concat([Buffer.from("....ftypisom"), box]);
}

const LOCATION_GRAPH = {
  "10": { class_type: "Text", inputs: { value: "" } },
  "11": { class_type: "Save", inputs: { filename_prefix: "a" } },
  "20": { class_type: "Text", inputs: { value: "" } },
  "21": { class_type: "Save", inputs: { filename_prefix: "b" } },
};

const LOCATION: GraphBinding = {
  format: "frameboard.graph-binding/1",
  id: "loc",
  graph: "g.json",
  stage: "location",
  label: "Локация",
  description: "",
  order: 1,
  inputs: {
    text: { kind: "text", from: "prompt", required: true, sections: ["simple", "objects"], untitled: "all", label: "prompt.md" },
  },
  slots: [
    { targets: [{ node: "10", field: "value" }], value: { input: "text", section: "simple" }, whenEmpty: { remove: [{ node: "11" }] } },
    { targets: [{ node: "20", field: "value" }], value: { input: "text", section: "objects" }, whenEmpty: { remove: [{ node: "21" }] } },
  ],
};

const BLOB = {
  short_edge: 768,
  face: { on: true },
  segments: [
    {
      prompt: "",
      refined: { body: "", sections: { subject_definitions: "", summary: "" } },
      assets: [
        { handle: "vid-1", filename: "" },
        { handle: "img-1", filename: "" },
        { handle: "img-2", filename: "" },
        { handle: "img-3", filename: "" },
      ],
      duration_s: 5,
    },
  ],
};

const H3_GRAPH = { "1": { class_type: "Creator", inputs: { creator_data: JSON.stringify(BLOB), seed: 0 } } };
const CD = (json: string) => ({ node: "1", field: "creator_data", json });

const FINAL: GraphBinding = {
  format: "frameboard.graph-binding/1",
  id: "final",
  graph: "h3.json",
  stage: "final_render",
  label: "Финал",
  description: "",
  order: 1,
  inputs: {
    video: { kind: "video", from: "approve:video_preview", pick: "newest", uploadAs: "{shotId}_ref{ext}", label: "Превью" },
    first: { kind: "image", from: "approve:first_frame", pick: "newest", label: "Первый кадр" },
    people: { kind: "image", from: "approve:characters", pick: "all", min: 0, max: 2, label: "Люди" },
    text: { kind: "text", from: "prompt", required: true, sections: ["body", "subject_definitions", "summary"], untitled: "body", label: "prompt.md" },
    wan: { kind: "text", from: "prompt", stage: "video_preview", required: false, label: "Wan" },
    duration: { kind: "number", from: "media:duration", of: "video", min: 1, max: 20, label: "Длительность" },
  },
  slots: [
    { targets: [CD("short_edge")], value: { const: 1152 } },
    { targets: [CD("face.on")], value: { const: false } },
    { targets: [CD("segments.0.assets.0.filename")], value: { input: "video" } },
    { targets: [CD("segments.0.assets.1.filename")], value: { input: "first" } },
    {
      targets: [CD("segments.0.assets.2.filename")],
      value: { input: "people", index: 0 },
      whenEmpty: { remove: [{ node: "1", field: "creator_data", json: "segments.0.assets.2" }] },
    },
    {
      targets: [CD("segments.0.assets.3.filename")],
      value: { input: "people", index: 1 },
      whenEmpty: { remove: [{ node: "1", field: "creator_data", json: "segments.0.assets.3" }] },
    },
    { targets: [CD("segments.0.refined.body")], value: { input: "text", section: "body", required: true } },
    ...(["subject_definitions", "summary"] as const).map((section) => ({
      targets: [CD(`segments.0.refined.sections.${section}`)],
      value: { input: "text", section },
      whenEmpty: { remove: [{ node: "1", field: "creator_data", json: `segments.0.refined.sections.${section}` }] },
    })),
    { targets: [CD("segments.0.prompt")], value: { input: "wan" } },
    { targets: [CD("segments.0.duration_s")], value: { input: "duration" } },
  ],
};

function dir(stage: StageId, sub = "") {
  return path.join(stageDir(EP, SHOT, stage), sub);
}

function prompt(stage: StageId, text: string) {
  fs.writeFileSync(dir(stage, "prompt.md"), text);
}

function blobOf(built: ReturnType<typeof buildPrompt>) {
  return JSON.parse(String(built.prompt["1"].inputs.creator_data));
}

before(() => {
  createEpisode(EP);
  fs.mkdirSync(shotDir(EP, SHOT), { recursive: true });
  fs.writeFileSync(path.join(shotDir(EP, SHOT), "shot.md"), "# Кадр\n\n- characters: катя, lena\n- location: cafe\n");
  ensureStageDirs(EP, SHOT);
  fs.writeFileSync(dir("video_preview", "approve/s01_i2v_00001_.mp4"), mp4(6062));
  fs.writeFileSync(dir("first_frame", "approve/ff.png"), PNG);
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("splitSections: заголовки, неизвестный раздел, текст до заголовка", () => {
  assert.equal(splitSections("plain text", ["a"]), null);
  const parts = splitSections("## simple\nOne.\n\n## objects\nTwo\nlines.", ["simple", "objects"])!;
  assert.equal(parts.get("simple"), "One.");
  assert.equal(parts.get("objects"), "Two\nlines.");
  assert.throws(() => splitSections("## other\nx", ["simple"]), /неизвестный раздел «## other»/);
  assert.throws(() => splitSections("intro\n## simple\nx", ["simple"]), /текст до первого заголовка/);
  assert.throws(() => splitSections("## simple\nx\n## simple\ny", ["simple"]), /дважды/);
});

test("sectionText: без заголовков — по правилу untitled", () => {
  const all = LOCATION.inputs.text as TextInput;
  assert.equal(sectionText("Same text.", all, "objects"), "Same text.");
  const body = { ...all, sections: ["body", "summary"], untitled: "body" };
  assert.equal(sectionText("Only body.", body, "body"), "Only body.");
  assert.equal(sectionText("Only body.", body, "summary"), "");
});

test("локация: без заголовков текст идёт во все ветки, с заголовками — по разделам, пустая ветка не запускается", () => {
  validateBinding(LOCATION, LOCATION_GRAPH);
  prompt("location", "A wide view. No people.");
  let built = buildPrompt(LOCATION, structuredClone(LOCATION_GRAPH), { episodeId: EP, shotId: SHOT, stageId: "location" });
  assert.equal(built.prompt["10"].inputs.value, "A wide view. No people.");
  assert.equal(built.prompt["20"].inputs.value, "A wide view. No people.");
  assert.ok(built.prompt["11"] && built.prompt["21"]);

  prompt("location", "## objects\nThe red carpet and the lamp. No people.");
  built = buildPrompt(LOCATION, structuredClone(LOCATION_GRAPH), { episodeId: EP, shotId: SHOT, stageId: "location" });
  assert.equal(built.prompt["20"].inputs.value, "The red carpet and the lamp. No people.");
  assert.equal(built.prompt["11"], undefined, "ветка simple без текста убрана");
  assert.ok(built.prompt["21"]);
});

test("финал: пути внутри creator_data, константы, ролик, длительность, лишние ассеты вырезаны", () => {
  validateBinding(FINAL, H3_GRAPH);
  prompt("video_preview", "Static shot, fixed camera. She smiles. Realistic, natural movement. 6 sec");
  prompt(
    "final_render",
    "## body\nThe scene begins from @img-1. use @vid-1 as a reference.\n\n## subject_definitions\n<Subject 1> is the young woman from @img-1.",
  );
  const built = buildPrompt(FINAL, structuredClone(H3_GRAPH), { episodeId: EP, shotId: SHOT, stageId: "final_render" });
  const blob = blobOf(built);
  assert.equal(blob.short_edge, 1152);
  assert.equal(blob.face.on, false);
  const segment = blob.segments[0];
  assert.deepEqual(
    segment.assets.map((asset: { handle: string; filename: string }) => [asset.handle, asset.filename]),
    [
      ["vid-1", "s01_ref.mp4"],
      ["img-1", "ff.png"],
    ],
    "без персонажей img-2 и img-3 вырезаны с конца",
  );
  assert.equal(segment.refined.body, "The scene begins from @img-1. use @vid-1 as a reference.");
  assert.equal(segment.refined.sections.subject_definitions, "<Subject 1> is the young woman from @img-1.");
  assert.equal("summary" in segment.refined.sections, false, "пустой раздел удалён — нода выведет его сама");
  assert.equal(segment.prompt, "Static shot, fixed camera. She smiles. Realistic, natural movement. 6 sec");
  assert.equal(segment.duration_s, 6);
  assert.deepEqual(
    built.uploads.map((upload) => upload.filename),
    ["s01_ref.mp4", "ff.png"],
  );
});

test("финал: два персонажа занимают img-2 и img-3", () => {
  fs.writeFileSync(dir("characters", "approve/katya_s01.png"), PNG);
  fs.writeFileSync(dir("characters", "approve/lena_s01.png"), PNG);
  const built = buildPrompt(FINAL, structuredClone(H3_GRAPH), { episodeId: EP, shotId: SHOT, stageId: "final_render" });
  const assets = blobOf(built).segments[0].assets;
  assert.deepEqual(
    assets.map((asset: { filename: string }) => asset.filename),
    ["s01_ref.mp4", "ff.png", "katya_s01.png", "lena_s01.png"],
  );
});

test("финал: без раздела body — понятная ошибка", () => {
  prompt("final_render", "## summary\nOnly a summary.");
  assert.throws(
    () => buildPrompt(FINAL, structuredClone(H3_GRAPH), { episodeId: EP, shotId: SHOT, stageId: "final_render" }),
    /нет раздела «## body»/,
  );
});

test("JSON-путь, которого нет в графе, — ошибка при проверке манифеста", () => {
  const broken = { ...FINAL, slots: [{ targets: [CD("segments.0.nope.deeper")], value: { const: 1 } }] };
  assert.throws(() => validateBinding(broken, H3_GRAPH), /нет пути segments\.0\.nope/);
});

test("длительность mp4 по mvhd", () => {
  assert.equal(videoDurationSeconds(dir("video_preview", "approve/s01_i2v_00001_.mp4")), 6.062);
});

test("русский текст: ловится, а имена персонажей и «5 сек» — нет", () => {
  assert.match(russianLine("Preview-видео s07, камера подъезжает") ?? "", /Preview/);
  assert.equal(russianLine("Катя smiles at Lena. 5 сек", ["катя"]), null);
  assert.equal(russianLine("Static shot. The girl smiles."), null);
  prompt("video_preview", "Камера медленно подъезжает к ним.\nThe camera dollies in.");
  assert.throws(
    () => buildPrompt(FINAL, structuredClone(H3_GRAPH), { episodeId: EP, shotId: SHOT, stageId: "final_render" }),
    /prompt\.md этапа video_preview содержит русский текст/,
  );
});

test("этап свободен, но помнит последнее задание", () => {
  writeStageState(EP, SHOT, "location", { phase: "comfy", jobId: "job-1", requestId: "req-1" });
  setIdle(EP, SHOT, "location");
  const file = readStageStateFile(EP, SHOT, "location");
  assert.equal(file?.phase, "idle");
  assert.equal(file?.jobId, "job-1");
});

test("история ComfyUI: mmc_video забирается, повторы и mmc_takes — нет", () => {
  const files = listHistoryImages({
    outputs: {
      "1:5": {
        mmc_video: [{ filename: "H3_00001_.mp4", subfolder: "frameboard/final", type: "output" }],
      },
      "1:6": { videos: [{ filename: "H3_00001_.mp4", subfolder: "frameboard/final", type: "output" }] },
    },
  });
  assert.deepEqual(files.map((file) => file.filename), ["H3_00001_.mp4"]);
});

