// Длительность клипа (бриф 03): settings:seconds → prompt:seconds → граф, PATCH runDuration, задача агенту.
// Настоящие манифесты video_i2v / video_flf и графы Wan из playbooks/, данные — во временной папке.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-duration-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;
delete process.env.FRAMEBOARD_AGENT_PROVIDER;

import type { GraphBinding } from "../contracts/graph-binding";
import { PATCH } from "../../app/api/episodes/[episodeId]/shots/[shotId]/stages/[stage]/route";
import { buildTextParts } from "../agent/task";
import { cancelAgentRequest, readAgentRequest, readLlmTask, submitAgentRequest } from "../series/agent-request";
import { createEpisode, ensureStageDirs, shotDir, stageDir } from "../series/paths";
import { readShotSpeech, speechPhrases } from "../series/speech";
import { readRunSettings, writeRunSettings } from "../series/run-settings";
import { setIdle } from "../series/stage-state";
import { getStageDetail } from "../series/scanner";
import { buildPrompt, durationRange, validateBinding } from "./binding";
import { readComfyJob } from "./queue";
import { queueStageRun } from "./stage-run";
import { requireStageBinding } from "./workflows";

const EP = "e01";
const STAGE = "video_preview";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const DURATION_NODE = "129:161";

function makeShot(shotId: string) {
  fs.mkdirSync(shotDir(EP, shotId), { recursive: true });
  fs.writeFileSync(path.join(shotDir(EP, shotId), "shot.md"), "# Утро\n\n- characters: katya\n- location: room\n");
  ensureStageDirs(EP, shotId);
  fs.writeFileSync(path.join(stageDir(EP, shotId, "first_frame"), "approve", "katya.png"), PNG);
}

function setPrompt(shotId: string, text: string) {
  fs.writeFileSync(path.join(stageDir(EP, shotId, STAGE), "prompt.md"), text);
}

function seconds(shotId: string, workflow = "video_i2v"): unknown {
  const { binding, graph } = requireStageBinding(STAGE, workflow);
  return buildPrompt(binding, graph, { episodeId: EP, shotId, stageId: STAGE }).prompt[DURATION_NODE].inputs.value;
}

function patch(shotId: string, body: unknown): Promise<Response> {
  const request = new Request("http://test/", { method: "PATCH", body: JSON.stringify(body) });
  return PATCH(request, { params: Promise.resolve({ episodeId: EP, shotId, stage: STAGE }) });
}

before(() => createEpisode(EP));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("манифесты видео: длительность из меню, иначе N sec из prompt.md, иначе граф", () => {
  makeShot("s01");
  for (const workflow of ["video_i2v", "video_flf"]) {
    const { binding } = requireStageBinding(STAGE, workflow);
    assert.equal(binding.inputs.seconds.kind === "number" && binding.inputs.seconds.from, "settings:seconds", workflow);
  }

  setPrompt("s01", "Static shot, fixed camera. She sits up. Realistic, natural movement.");
  assert.equal(seconds("s01"), 5, "ни выбора, ни N sec — значение графа");

  setPrompt("s01", "Static shot, fixed camera. She sits up. Realistic, natural movement. 3 sec");
  assert.equal(seconds("s01"), 3, "нет выбора — из prompt.md");

  writeRunSettings(EP, "s01", STAGE, { durationSec: 4 });
  assert.equal(seconds("s01"), 4, "выбор в меню важнее prompt.md");
  fs.writeFileSync(path.join(stageDir(EP, "s01", "video_preview"), "refs", "s01_end.png"), PNG);
  assert.equal(seconds("s01", "video_flf"), 4, "FLF тоже");

  writeRunSettings(EP, "s01", STAGE, { durationSec: 13 });
  assert.equal(seconds("s01"), 3, "выбор вне min..max не уходит в граф");
});

test("durationRange: min/max манифеста, «по умолчанию» — prompt.md или граф; без входа — null", () => {
  makeShot("s02");
  const { binding, graph } = requireStageBinding(STAGE, "video_i2v");
  const ctx = { episodeId: EP, shotId: "s02", stageId: STAGE } as const;
  setPrompt("s02", "She sits up. Realistic, natural movement.");
  assert.deepEqual(durationRange(binding, graph, ctx), { min: 2, max: 12, default: 5 });
  setPrompt("s02", "She sits up. Realistic, natural movement. 6 sec");
  assert.deepEqual(durationRange(binding, graph, ctx), { min: 2, max: 12, default: 6 });

  const legacy = structuredClone(binding) as GraphBinding;
  legacy.inputs.seconds = { kind: "number", from: "prompt:seconds", min: 2, max: 8, label: "Секунды" };
  assert.equal(durationRange(legacy, graph, ctx), null);

  const noRange = structuredClone(binding) as GraphBinding;
  noRange.inputs.seconds = { kind: "number", from: "settings:seconds", label: "Секунды" };
  assert.throws(() => validateBinding(noRange, graph), /settings:seconds нужны целые min <= max/);
  const badFallback = structuredClone(legacy);
  (badFallback.inputs.seconds as { fallback?: string }).fallback = "prompt:seconds";
  assert.throws(() => validateBinding(badFallback, graph), /fallback только у settings:seconds/);
});

test("PATCH runDuration: пишет durationSec, не трогает воркфлоу; вне min..max и не число — 400; пусто — сброс", async () => {
  makeShot("s03");
  setPrompt("s03", "She sits up. Realistic, natural movement.");
  let res = await patch("s03", { runWorkflow: "video_flf" });
  assert.equal(res.status, 200);

  res = await patch("s03", { runDuration: 4 });
  assert.equal(res.status, 200);
  const detail = (await res.json()) as ReturnType<typeof getStageDetail>;
  assert.equal(detail.durationSec, 4);
  assert.deepEqual(detail.durationRange, { min: 2, max: 12, default: 5 });
  assert.equal(detail.workflow, "video_flf");
  assert.equal(readRunSettings(EP, "s03", STAGE).durationSec, 4);

  res = await patch("s03", { runWorkflow: "video_i2v" });
  assert.equal(readRunSettings(EP, "s03", STAGE).durationSec, 4, "смена воркфлоу длительность не сбрасывает");

  for (const bad of [13, 1, "abc", 4.5]) {
    res = await patch("s03", { runDuration: bad });
    assert.equal(res.status, 400, String(bad));
  }
  assert.match(((await (await patch("s03", { runDuration: 13 })).json()) as { error: string }).error, /вне 2–12/);
  assert.equal(readRunSettings(EP, "s03", STAGE).durationSec, 4, "ошибка ничего не пишет");

  res = await patch("s03", { runDuration: "12" });
  assert.equal(readRunSettings(EP, "s03", STAGE).durationSec, 12, "строка из селекта, верхняя граница 12");
  res = await patch("s03", { runDuration: "" });
  assert.equal(res.status, 200);
  assert.equal(readRunSettings(EP, "s03", STAGE).durationSec, undefined);
  assert.equal(readRunSettings(EP, "s03", STAGE).workflow, "video_i2v");

  // У этапа без входа settings:seconds выбора нет.
  const other = new Request("http://test/", { method: "PATCH", body: JSON.stringify({ runDuration: 4 }) });
  res = await PATCH(other, { params: Promise.resolve({ episodeId: EP, shotId: "s03", stage: "first_frame" }) });
  assert.equal(res.status, 400);
});

test("запуск: в задании очереди 129:161 = выбранное", async () => {
  makeShot("s04");
  setPrompt("s04", "Static shot, fixed camera. She sits up. Realistic, natural movement.");
  assert.equal((await patch("s04", { runDuration: 4 })).status, 200);
  const { id } = queueStageRun(EP, "s04", STAGE);
  const job = readComfyJob(id)!;
  assert.equal(job.workflow, "video_i2v");
  assert.equal(job.prompt[DURATION_NODE].inputs.value, 4);
});

test("задача агенту: длительность в text-режиме и в llm_task.md, только если выбрана", () => {
  makeShot("s05");
  setPrompt("s05", "She sits up.");
  const submit = () =>
    submitAgentRequest({
      episodeId: EP,
      shotId: "s05",
      stageId: STAGE,
      message: "Медленнее",
      prompt: "She sits up.",
      refsNote: "",
      workflowNote: "",
      provider: "manual",
    });

  submit();
  const request = readAgentRequest(EP, "s05", STAGE)!;
  assert.doesNotMatch(buildTextParts(request).user, /clip duration/);
  assert.doesNotMatch(readLlmTask(EP, "s05", STAGE), /Длительность клипа/);

  writeRunSettings(EP, "s05", STAGE, { durationSec: 3 });
  assert.match(buildTextParts(request).user, /- clip duration: 3 s, chosen by the user/);
  cancelAgentRequest(EP, "s05", STAGE);
  setIdle(EP, "s05", STAGE);
  submit();
  assert.match(readLlmTask(EP, "s05", STAGE), /Длительность клипа: 3 с\. Действие должно уложиться в это время\./);
});

test("реплики: speech.md кадра, PATCH только на видео-этапах, пусто — файла нет", async () => {
  makeShot("s06");
  let detail = getStageDetail(EP, "s06", STAGE);
  assert.equal(detail.hasSpeech, true);
  assert.equal(detail.docs.speech, "");
  assert.equal(getStageDetail(EP, "s06", "first_frame").hasSpeech, false);

  assert.equal((await patch("s06", { speech: "Катя: Мама, я дома." })).status, 200);
  assert.equal(readShotSpeech(EP, "s06"), "Катя: Мама, я дома.\n");
  assert.equal(getStageDetail(EP, "s06", "final_render").docs.speech, "Катя: Мама, я дома.\n", "один файл на кадр");

  const other = new Request("http://test/", { method: "PATCH", body: JSON.stringify({ speech: "Чужое" }) });
  await PATCH(other, { params: Promise.resolve({ episodeId: EP, shotId: "s06", stage: "first_frame" }) });
  assert.equal(readShotSpeech(EP, "s06"), "Катя: Мама, я дома.\n", "на других этапах поле игнорируется");

  await patch("s06", { speech: "  " });
  assert.equal(fs.existsSync(path.join(shotDir(EP, "s06"), "speech.md")), false);
  detail = getStageDetail(EP, "s06", STAGE);
  assert.equal(detail.docs.speech, "");
});

test("реплики: имя и кавычки снимаются; кириллица в prompt.md не проходит, английская реплика — проходит", async () => {
  assert.deepEqual(speechPhrases('Катя: «Мама, я дома.»\n\n- Мама: "Иди есть."\nТишина в доме'), [
    "Мама, я дома.",
    "Иди есть.",
    "Тишина в доме",
  ]);
  makeShot("s07");
  await patch("s07", { speech: "Катя: Мама, я дома." });
  setPrompt("s07", 'Static shot, fixed camera. She says: "Mom, I am home." Realistic, natural movement.');
  assert.equal(seconds("s07"), 5, "реплика по-английски, кириллицы нет");
  setPrompt("s07", 'Static shot, fixed camera. She says: "Мама, я дома." Realistic, natural movement.');
  assert.throws(() => seconds("s07"), /русский текст/);
});

test("реплики в задаче агенту: llm_task.md и text-режим", () => {
  makeShot("s08");
  setPrompt("s08", "She sits up.");
  const submit = () =>
    submitAgentRequest({
      episodeId: EP,
      shotId: "s08",
      stageId: STAGE,
      message: "Пусть скажет",
      prompt: "She sits up.",
      refsNote: "",
      workflowNote: "",
      provider: "manual",
    });
  submit();
  assert.match(readLlmTask(EP, "s08", STAGE), /## Реплики \(shots\/s08\/speech\.md\)\n\nПусто: в кадре никто не говорит\./);
  const request = readAgentRequest(EP, "s08", STAGE)!;
  assert.match(buildTextParts(request).user, /\(none: nobody speaks in this shot\)/);

  fs.writeFileSync(path.join(shotDir(EP, "s08"), "speech.md"), "Катя: Мама, я дома.\n");
  assert.match(buildTextParts(request).user, /## Lines \(speech\.md[^\n]*\n\nКатя: Мама, я дома\./);
  cancelAgentRequest(EP, "s08", STAGE);
  setIdle(EP, "s08", STAGE);
  submit();
  assert.match(readLlmTask(EP, "s08", STAGE), /## Реплики[^\n]*\n\nКатя: Мама, я дома\./);
  assert.match(readLlmTask(EP, "s08", STAGE), /## Правила prompt\.md/);
  assert.match(buildTextParts(request).system, /character1, character2, character3/);
  assert.match(buildTextParts(request).system, /No Cyrillic/);
});
