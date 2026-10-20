// Финал берёт промпт утверждённого эскиза из метаданных ролика (SaveVideo, ключ prompt).
// Нет метаданных — prompt.md эскиза и пометка в run_log. Эскиз LTX → по умолчанию final_ltx.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-final-sketch-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import { createEpisode, ensureStageDirs, shotDir, stageDir } from "../series/paths";
import { approvedMetaTexts, buildPrompt, readVideoPromptText, sketchPromptTaskNote, stageBindings } from "./binding";
import { listWorkflowChoices } from "./workflows";

const EP = "e01";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const WAN_NODE = "129:93";
const LTX_NODE = "398:376";
const BACKGROUND =
  "The background stays exactly as in the first frame for the whole clip: no new people appear, nobody walks or moves in the background, doors, windows and curtains stay as they are, and no new objects appear. Only the movements described above happen.";

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function box(type: string, payload: Buffer): Buffer {
  return Buffer.concat([u32(8 + payload.length), Buffer.from(type, "ascii"), payload]);
}

/** Атом mvhd v0: timescale 1000, длительность ms. Совпадает с разбором videoDurationSeconds. */
function mvhd(ms: number): Buffer {
  const payload = Buffer.alloc(100);
  payload.writeUInt32BE(1000, 12);
  payload.writeUInt32BE(ms, 16);
  return box("mvhd", payload);
}

/**
 * mp4 как у SaveVideo: `movflags=use_metadata_tags`, ключ prompt — JSON графа API.
 * Рядом ключ encoder, чтобы разбор не считал prompt единственным тегом.
 */
function mp4WithPrompt(graph: Record<string, unknown>, ms = 5000): Buffer {
  const names = ["prompt", "encoder"];
  const keyEntries = names.map((name) => box("mdta", Buffer.from(name, "utf8")));
  const keys = box("keys", Buffer.concat([Buffer.alloc(4), u32(names.length), ...keyEntries]));
  const values = [JSON.stringify(graph), "Lavf"];
  const ilstEntries = values.map((text, index) => {
    const body = Buffer.from(text, "utf8");
    const data = Buffer.concat([u32(16 + body.length), Buffer.from("data", "ascii"), u32(1), u32(0), body]);
    return Buffer.concat([u32(8 + data.length), u32(index + 1), data]);
  });
  const ilst = box("ilst", Buffer.concat(ilstEntries));
  const meta = box("meta", Buffer.concat([Buffer.alloc(4), keys, ilst]));
  const moov = box("moov", Buffer.concat([mvhd(ms), box("udta", meta)]));
  return Buffer.concat([box("ftyp", Buffer.from("isom", "ascii")), moov, box("mdat", Buffer.alloc(0))]);
}

function wanGraph(text: string): Record<string, unknown> {
  return { [WAN_NODE]: { class_type: "CLIPTextEncode", inputs: { text } } };
}

function ltxGraph(text: string): Record<string, unknown> {
  return { [LTX_NODE]: { class_type: "PrimitiveStringMultiline", inputs: { value: text } } };
}

function putApprove(name: string, bytes: Buffer) {
  const file = path.join(stageDir(EP, "s01", "video_preview"), "approve", name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  const now = Date.now();
  fs.utimesSync(file, now / 1000, now / 1000);
  return file;
}

function clearApprove() {
  const dir = path.join(stageDir(EP, "s01", "video_preview"), "approve");
  for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true });
}

function defaultFinal(): string | undefined {
  return listWorkflowChoices(EP, "s01", "final_render").find((choice) => choice.isDefault)?.id;
}

function buildFinal(workflow: string) {
  const loaded = stageBindings("final_render").find((item) => item.id === workflow)!;
  assert.equal(loaded.error, null, loaded.error ?? "");
  return buildPrompt(loaded.binding!, structuredClone(loaded.graph!), {
    episodeId: EP,
    shotId: "s01",
    stageId: "final_render",
    random: () => 7,
  });
}

before(() => {
  createEpisode(EP);
  fs.mkdirSync(shotDir(EP, "s01"), { recursive: true });
  fs.writeFileSync(path.join(shotDir(EP, "s01"), "shot.md"), "# s01\n\n- characters: lena\n- location: hall\n");
  ensureStageDirs(EP, "s01");
  fs.mkdirSync(path.join(stageDir(EP, "s01", "first_frame"), "approve"), { recursive: true });
  fs.writeFileSync(path.join(stageDir(EP, "s01", "first_frame"), "approve", "ff.png"), PNG);
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("разбор ключа prompt из mp4 SaveVideo", () => {
  const file = path.join(tmp, "probe.mp4");
  fs.writeFileSync(file, mp4WithPrompt(wanGraph("Static shot. Lena turns.")));
  assert.equal(readVideoPromptText(file, [{ node: WAN_NODE, field: "text" }]).text, "Static shot. Lena turns.");
  assert.equal(readVideoPromptText(file, [{ node: LTX_NODE, field: "value" }]).metadata, true);
  assert.equal(readVideoPromptText(file, [{ node: LTX_NODE, field: "value" }]).text, null);
  assert.equal(readVideoPromptText(path.join(tmp, "missing.mp4"), [{ node: WAN_NODE, field: "text" }]).metadata, false);
});

test("финал Wan берёт промпт из метаданных ролика, а не из позже правленого prompt.md", () => {
  clearApprove();
  putApprove("s01_i2v_00001_.mp4", mp4WithPrompt(wanGraph("Static shot. Lena turns her head.")));
  fs.writeFileSync(
    path.join(stageDir(EP, "s01", "video_preview"), "prompt.md"),
    "EDITED AFTER APPROVE. This text must not reach Wan.",
  );
  assert.equal(defaultFinal(), "final_wan_720");
  const { prompt } = buildFinal("final_wan_720");
  assert.equal(prompt["129:93"].inputs.text, `Static shot. Lena turns her head. ${BACKGROUND}`);
  assert.equal(prompt["129:98"].inputs.width, 720);
  assert.equal(prompt["129:162"].inputs.value, 24);
  const logFile = path.join(stageDir(EP, "s01", "final_render"), "run_log.md");
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  assert.doesNotMatch(log, /нет метаданных/);
});

test("без метаданных финал берёт prompt.md эскиза и пишет пометку в run_log", () => {
  clearApprove();
  putApprove("s01_i2v_00001_.mp4", Buffer.from("not a real video"));
  fs.writeFileSync(path.join(stageDir(EP, "s01", "video_preview"), "prompt.md"), "Static shot. Lena turns her head. 5 sec");
  const logFile = path.join(stageDir(EP, "s01", "final_render"), "run_log.md");
  fs.rmSync(logFile, { force: true });
  assert.equal(defaultFinal(), "final_wan_720");
  const { prompt } = buildFinal("final_wan_720");
  assert.match(String(prompt["129:93"].inputs.text), /^Static shot\. Lena turns her head\. 5 sec /);
  const log = fs.readFileSync(logFile, "utf8");
  assert.match(log, /нет метаданных промпта/);
  assert.match(log, /prompt\.md этапа video_preview/);
  const loaded = stageBindings("final_render").find((item) => item.id === "final_wan_720")!;
  const note = sketchPromptTaskNote({ episodeId: EP, shotId: "s01", stageId: "final_render" }, loaded.binding!);
  assert.match(note ?? "", /нет метаданных промпта/);
});

test("эскиз LTX по метаданным — по умолчанию финал LTX, даже если в кадре есть реплики", () => {
  clearApprove();
  putApprove(
    "s01_ltx_00001_.mp4",
    mp4WithPrompt(ltxGraph("use image as the first frame. The young woman turns her head. Static camera.")),
  );
  fs.writeFileSync(path.join(stageDir(EP, "s01", "video_preview"), "prompt.md"), "Static shot. Edited later.");
  fs.writeFileSync(path.join(shotDir(EP, "s01"), "speech.md"), "Lena: Who are you?\n");
  try {
    assert.equal(defaultFinal(), "final_ltx");
    const { prompt } = buildFinal("final_ltx");
    assert.match(String(prompt["398:376"].inputs.value), /^use image as the first frame\. The young woman turns/);
    assert.equal(prompt["403"].inputs.megapixels, 1.2);
    assert.deepEqual(prompt["398:372"].inputs.value, ["403", 0]);
    assert.deepEqual(prompt["398:360"].inputs.value, ["403", 1]);
    assert.equal(prompt["398:361"].inputs.value, 24);
    assert.equal(prompt["398:362"].inputs.value, 5);
    assert.equal(prompt["398:339"].inputs.noise_seed, 7);
    assert.equal(prompt["75"].inputs.filename_prefix, "frameboard/final/s01_ltx");
  } finally {
    fs.rmSync(path.join(shotDir(EP, "s01"), "speech.md"), { force: true });
  }
});

test("эскиз Wan — final_wan_720; один говорящий — H3; диалог — HeyGen", () => {
  clearApprove();
  putApprove("s01_i2v_00001_.mp4", mp4WithPrompt(wanGraph("Static shot. Lena stands.")));
  assert.equal(defaultFinal(), "final_wan_720");
  fs.writeFileSync(path.join(shotDir(EP, "s01"), "speech.md"), "Lena: Don't mind him.\n");
  try {
    assert.equal(defaultFinal(), "final_h3_cinema");
    fs.writeFileSync(path.join(shotDir(EP, "s01"), "speech.md"), "Lena: Don't mind him.\nJulia: But why?\n");
    assert.equal(defaultFinal(), "final_heygen");
  } finally {
    fs.rmSync(path.join(shotDir(EP, "s01"), "speech.md"), { force: true });
  }
  assert.equal(defaultFinal(), "final_wan_720");
});

test("нет метаданных: имя файла _ltx выбирает финал LTX, имя _i2v — нет; метаданные Wan важнее имени _ltx", () => {
  clearApprove();
  putApprove("s01_ltx_00001_.mp4", Buffer.from("not a real video"));
  fs.writeFileSync(path.join(stageDir(EP, "s01", "video_preview"), "prompt.md"), "use image as the first frame. She waits.");
  assert.equal(defaultFinal(), "final_ltx");
  clearApprove();
  putApprove("s01_i2v_00001_.mp4", Buffer.from("not a real video"));
  assert.equal(defaultFinal(), "final_wan_720");
  clearApprove();
  putApprove("renamed_ltx.mp4", mp4WithPrompt(wanGraph("Static shot. Lena stands.")));
  assert.equal(defaultFinal(), "final_wan_720", "в метаданных нода Wan, подстрока _ltx в имени не считается");
});

test("H3 Cinema: агент получает промпт эскиза из метаданных, а не правленый prompt.md", () => {
  clearApprove();
  putApprove("s01_i2v_00001_.mp4", mp4WithPrompt(wanGraph("Static shot. Lena holds still.")));
  fs.writeFileSync(path.join(stageDir(EP, "s01", "video_preview"), "prompt.md"), "EDITED AFTER APPROVE.");
  const binding = stageBindings("final_render").find((item) => item.id === "final_h3_cinema")!.binding!;
  const texts = approvedMetaTexts({ episodeId: EP, shotId: "s01", stageId: "final_render" }, binding);
  assert.deepEqual(texts.map((item) => item.text), ["Static shot. Lena holds still."]);
  assert.match(texts[0].where, /^метаданные s01_i2v_00001_\.mp4$/);
});

test("эскиз FLF: по умолчанию финал FLF 720×1280, 24 к/с, промпт и последний кадр эскиза", () => {
  clearApprove();
  // Граф FLF: у него есть нода последнего кадра 98, у i2v её нет.
  const flf = { [WAN_NODE]: { class_type: "CLIPTextEncode", inputs: { text: "Static camera. She sits down on the bench." } }, "98": { class_type: "LoadImage", inputs: { image: "s01_end.png" } } };
  putApprove("s01_flf_00001_.mp4", mp4WithPrompt(flf, 4000));
  fs.writeFileSync(path.join(stageDir(EP, "s01", "video_preview"), "prompt.md"), "EDITED AFTER APPROVE.");
  const end = path.join(stageDir(EP, "s01", "video_preview"), "refs", "end.png");
  fs.mkdirSync(path.dirname(end), { recursive: true });
  fs.writeFileSync(end, PNG);
  assert.equal(defaultFinal(), "final_flf");

  const { prompt, uploads } = buildFinal("final_flf");
  assert.deepEqual([prompt["129:98"].inputs.width, prompt["129:98"].inputs.height], [720, 1280]);
  assert.equal(prompt["129:162"].inputs.value, 24);
  assert.equal(prompt["129:161"].inputs.value, 4, "длина превью");
  assert.equal(prompt[WAN_NODE].inputs.text, `Static camera. She sits down on the bench. ${BACKGROUND}`);
  assert.equal(prompt["98"].inputs.image, "s01_end.png");
  assert.ok(uploads.some((item) => item.path === end), "последний кадр из refs/ эскиза");
  assert.equal(prompt["108"].inputs.filename_prefix, "frameboard/final/s01_flf720");

  // Свой последний кадр в refs/ финала важнее эскиза.
  const own = path.join(stageDir(EP, "s01", "final_render"), "refs", "my_end.png");
  fs.mkdirSync(path.dirname(own), { recursive: true });
  fs.writeFileSync(own, PNG);
  assert.ok(buildFinal("final_flf").uploads.some((item) => item.path === own));
  fs.rmSync(own);

  // Эскиз i2v FLF по умолчанию не выбирает.
  clearApprove();
  putApprove("s01_i2v_00001_.mp4", mp4WithPrompt(wanGraph("Static shot. Lena stands.")));
  assert.equal(defaultFinal(), "final_wan_720");
});
