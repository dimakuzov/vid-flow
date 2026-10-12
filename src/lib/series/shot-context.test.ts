// Описания утверждённых картинок, действие кадра под них, замечания пользователя, модель этапа.
// Claude подменён: тест считает вызовы и проверяет, что уходит в задачу агенту.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-context-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;
delete process.env.FRAMEBOARD_AGENT_PROVIDER;

import type { AgentRequestFile, AgentTask } from "../contracts/agent-request";
import { overrideClaudeOneShot, type OneShotRequest } from "../agent/claude-oneshot";
import { stageModel } from "../agent/config";
import { overrideAgentProvider } from "../agent/providers";
import { agentRunPromise } from "../agent/runner";
import { buildTextParts } from "../agent/task";
import { readAgentRequest, submitAgentRequest } from "./agent-request";
import { runStageForAllShots } from "./bulk";
import type { StageId } from "./constants";
import { approvedImages, describePendingImages, ensureShotDescriptions, shotDescriptions } from "./descriptions";
import { createEpisode, ensureStageDirs, shotDir, stageDir, writeCurrentEpisodeId } from "./paths";
import { getStageDetail } from "./scanner";
import { actionStale, ensureShotAction, readShotAction, saveUserAction } from "./shot-action";
import { writeShotAgent } from "./shot-agent";
import { writeStageState } from "./stage-state";
import { deleteShotNote, readShotNotes } from "./shot-notes";

const EP = "e01";
const calls: OneShotRequest[] = [];

function png(seed: string): Buffer {
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from(seed)]);
}

function put(file: string, content: Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function shot(shotId: string, summary: string) {
  fs.mkdirSync(shotDir(EP, shotId), { recursive: true });
  fs.writeFileSync(
    path.join(shotDir(EP, shotId), "shot.md"),
    `# ${shotId}\n\n- characters: lena\n- location: stairs\n\n## Summary\n${summary}\n`,
  );
  ensureStageDirs(EP, shotId);
}

function approve(shotId: string, stage: StageId, name: string, content: Buffer) {
  put(path.join(stageDir(EP, shotId, stage), "approve", name), content);
}

function send(shotId: string, stageId: StageId, message: string, extra: Partial<Parameters<typeof submitAgentRequest>[0]> = {}) {
  // Фоновых циклов в тесте нет: этап после прошлого ответа агента освобождаем сами.
  writeStageState(EP, shotId, stageId, { phase: "idle" });
  return submitAgentRequest({
    episodeId: EP,
    shotId,
    stageId,
    message,
    prompt: "",
    refsNote: "",
    workflowNote: "",
    provider: "claude",
    ...extra,
  });
}

const tasks: AgentTask[] = [];

before(() => {
  createEpisode(EP);
  writeCurrentEpisodeId(EP);
  overrideClaudeOneShot(async (request) => {
    calls.push(request);
    if (request.image) {
      const kind = /fixed background/.test(request.prompt) ? "location" : /reference of one character/.test(request.prompt) ? "character" : "frame";
      return { text: `${kind} seen: ${fs.readFileSync(request.image).subarray(8).toString()}`, usage: {}, model: "fake" };
    }
    return { text: `Лена стоит у окна (действие №${calls.filter((item) => !item.image).length}).`, usage: {}, model: "fake" };
  });
  overrideAgentProvider("claude", {
    id: "claude",
    label: "Claude (fake)",
    modes: ["text", "agent"],
    async check() {
      return { available: true };
    },
    async run(task) {
      tasks.push(task);
      return { status: "done", prompt: "Place Lena from image 2 into the stairwell from image 1." };
    },
  });
});

after(() => {
  overrideClaudeOneShot(null);
  overrideAgentProvider("claude", null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  calls.length = 0;
  tasks.length = 0;
});

test("один и тот же файл в разных кадрах смотрится один раз; новый файл на месте утверждённого — заново", async () => {
  shot("s01", "Лена бежит вверх по лестнице, лицом к камере.");
  shot("s02", "Лена у окна.");
  approve("s01", "location", "stairs.png", png("landing with window"));
  approve("s01", "characters", "lena_s01.png", png("red hair, white jacket"));
  approve("s02", "characters", "lena_s02.png", png("red hair, white jacket"));

  const signal = new AbortController().signal;
  await ensureShotDescriptions(EP, "s01", signal);
  await ensureShotDescriptions(EP, "s02", signal);
  assert.equal(calls.length, 2, "локация s01 и одна Лена на два кадра");
  const lena = shotDescriptions(EP, "s02").find((item) => item.image.kind === "character")!;
  assert.match(lena.description!.text, /white jacket/);

  approve("s02", "characters", "lena_s02.png", png("red hair, grey coat"));
  await ensureShotDescriptions(EP, "s02", signal);
  assert.equal(calls.length, 3, "файл заменили руками — смотрим новый");
  assert.match(shotDescriptions(EP, "s02")[0].description!.text, /grey coat/);
});

test("фоновый цикл сам описывает новое в approve текущего эпизода", async () => {
  approve("s02", "location", "window.png", png("window, mailboxes"));
  describePendingImages();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 1);
  assert.equal(approvedImages(EP, "s02")[0].kind, "location");
  assert.ok(shotDescriptions(EP, "s02")[0].description);
});

test("действие кадра пишется по картинкам один раз и не пересобирается без причины", async () => {
  const signal = new AbortController().signal;
  const first = await ensureShotAction(EP, "s01", signal);
  assert.match(first, /Лена стоит у окна/);
  assert.equal(calls.length, 1);
  const task = calls[0].prompt;
  assert.match(task, /Scenario text of shot s01/);
  assert.match(task, /location seen: landing with window/);
  assert.match(task, /Character: lena\n\ncharacter seen: red hair, white jacket/);
  assert.match(task, /Previous shots|notes for this shot/);

  await ensureShotAction(EP, "s01", signal);
  assert.equal(calls.length, 1, "основа та же");
  assert.equal(actionStale(EP, "s01"), false);
});

test("замечания: каждое сообщение остаётся в истории кадра, агент видит прошлые, действие пересобирается", async () => {
  approve("s01", "location", "stairs.png", png("landing with window"));
  const request = send("s01", "first_frame", "Лена стоит спиной, уходит от камеры");
  await agentRunPromise(EP, request.id);
  assert.equal(readAgentRequest(EP, "s01", "first_frame")?.status, "done");
  assert.equal(readShotNotes(EP, "s01").length, 1);
  assert.equal(calls.filter((item) => !item.image).length, 1, "новое замечание — новое действие");
  assert.match(calls[calls.length - 1].prompt, /\[Первый кадр, [^\]]+\] Лена стоит спиной/);

  const second = send("s01", "first_frame", "сумка мешок");
  await agentRunPromise(EP, second.id);
  const user = tasks[tasks.length - 1].user;
  assert.match(user, /## User request\n\nсумка мешок/);
  assert.match(user, /earlier notes for this shot[\s\S]*1\. \[Первый кадр, [^\]]+\] Лена стоит спиной/);
  assert.doesNotMatch(user, /\d\. \[[^\]]+\] сумка мешок/, "текущее сообщение — только как запрос");
  assert.match(user, /Shot action adapted to the approved pictures \(action\.md\)\n\nЛена стоит у окна/);
  assert.match(user, /What the approved pictures actually show[\s\S]*Character lena/);
  assert.match(user, /Priority, highest first/);

  const detail = getStageDetail(EP, "s01", "first_frame");
  assert.equal(detail.notes.length, 2);
  assert.ok(detail.shotContext?.action);
  assert.equal(detail.shotContext?.images.length, 2);

  assert.ok(deleteShotNote(EP, "s01", detail.notes[0].id));
  assert.equal(readShotNotes(EP, "s01").length, 1);
});

test("массовый запуск не пишет замечаний; первый кадр у Claude — Sonnet, даже если кадру назначен Haiku", async () => {
  writeShotAgent(EP, "s02", { provider: "claude", model: "claude-haiku-5-5" });
  approve("s02", "location", "window.png", png("window, mailboxes"));
  const before = readShotNotes(EP, "s02").length;
  const result = runStageForAllShots(EP, "first_frame", { redo: true });
  const started = result.started.find((item) => item.shotId === "s02");
  assert.ok(started, JSON.stringify(result.skipped));
  const request = readAgentRequest(EP, "s02", "first_frame") as AgentRequestFile;
  assert.equal(request.model, "claude-sonnet-5-5");
  await agentRunPromise(EP, request.id);
  assert.equal(readShotNotes(EP, "s02").length, before);

  assert.equal(stageModel("claude", "video_preview", "claude-haiku-5-5"), "claude-haiku-5-5");
  assert.equal(stageModel("ollama", "first_frame", "qwen"), "qwen");
});

test("правка действия пользователем сохраняется и уходит модели как его версия", async () => {
  saveUserAction(EP, "s01", "Лена у почтовых ящиков, спиной к нам.");
  const signal = new AbortController().signal;
  assert.equal(await ensureShotAction(EP, "s01", signal), "Лена у почтовых ящиков, спиной к нам.");
  assert.equal(calls.length, 0, "основа не менялась — версия пользователя как есть");
  assert.equal(getStageDetail(EP, "s01", "first_frame").shotContext?.actionEditedByUser, true);

  const request = send("s01", "first_frame", "она смотрит в окно");
  await agentRunPromise(EP, request.id);
  const actionTask = calls.find((item) => !item.image)!.prompt;
  assert.match(actionTask, /The user's own version of the action[^\n]*\n\nЛена у почтовых ящиков/);
  assert.notEqual(readShotAction(EP, "s01"), "Лена у почтовых ящиков, спиной к нам.");
});

test("видео: в задаче описание утверждённого первого кадра; на первом кадре прошлый вариант не показываем", async () => {
  approve("s01", "first_frame", "s01_first.png", png("Lena at the window, back to camera"));
  await ensureShotDescriptions(EP, "s01", new AbortController().signal);
  const video = buildTextParts({ episodeId: EP, shotId: "s01", stageId: "video_preview", message: "x", createdAt: new Date().toISOString() } as AgentRequestFile).user;
  assert.match(video, /Approved first frame \(the video starts from exactly this frame\)\n\nframe seen: Lena at the window/);
  const first = buildTextParts({ episodeId: EP, shotId: "s01", stageId: "first_frame", message: "x", createdAt: new Date().toISOString() } as AgentRequestFile).user;
  assert.doesNotMatch(first, /Approved first frame/);
  assert.equal(getStageDetail(EP, "s01", "location").shotContext, null);
});
