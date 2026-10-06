// Запуск на машине с проектом: node --import tsx --test src/lib/series/stage-state.test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-state-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
delete process.env.SERIES_ROOT;
// Фоновую очередь в тесте не запускаем: задания остаются файлами.
(globalThis as { __frameboardComfyQueue?: boolean }).__frameboardComfyQueue = true;

import { submitAgentRequest, readAgentRequest } from "./agent-request";
import { cancelStage, reconcileStage } from "./agent-dispatch";
import { queueStageRun } from "../comfy/stage-run";
import { readComfyJob } from "../comfy/queue";
import { ensureEpisode, ensureStageDirs, stageDir, shotDir } from "./paths";
import { readStageState, readStageStateFile, writeStageState } from "./stage-state";
import { deriveStageStatus } from "./status";

const SHOT = "s01";
const STAGE = "location" as const;
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

function dir(...parts: string[]): string {
  return path.join(stageDir(SHOT, STAGE), ...parts);
}

function sendToAgent(message = "Сделай вечер") {
  return submitAgentRequest({
    shotId: SHOT,
    stageId: STAGE,
    message,
    prompt: "Evening light over the old cafe.",
    refsNote: "",
    workflowNote: "",
  });
}

function markAgentDone() {
  const file = dir("agent_request.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...data, status: "done" }));
}

function patchJob(id: string, patch: Record<string, unknown>) {
  const file = path.join(tmp, "comfy_queue", `${id}.json`);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...data, ...patch }));
}

before(() => {
  ensureEpisode("e01");
  fs.mkdirSync(shotDir(SHOT), { recursive: true });
  fs.writeFileSync(path.join(shotDir(SHOT), "shot.md"), "# Cafe\n\n- location: cafe\n");
  ensureStageDirs(SHOT);
  fs.writeFileSync(dir("refs", "view.png"), PNG);
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("новый этап свободен", () => {
  const state = readStageState(SHOT, STAGE);
  assert.equal(state.phase, "idle");
  assert.equal(state.busy, false);
});

test("отправка агенту: фаза agent, поле рекомендации очищено, этап закрыт", () => {
  fs.writeFileSync(dir("llm_notes.md"), "Сделай вечер");
  const request = sendToAgent();
  assert.equal(readStageState(SHOT, STAGE).phase, "agent");
  assert.equal(fs.readFileSync(dir("llm_notes.md"), "utf8"), "");
  assert.equal(readAgentRequest(SHOT, STAGE)?.message, "Сделай вечер");
  assert.equal(readStageStateFile(SHOT, STAGE)?.requestId, request.id);
  assert.throws(() => sendToAgent("ещё раз"), /Этап занят/);
  assert.throws(() => queueStageRun(SHOT, STAGE), /Этап занят/);
  assert.equal(deriveStageStatus(SHOT, STAGE, []), "agent");
});

test("агент закончил → задание в очереди, в модель идёт prompt.md, не рекомендация", () => {
  fs.writeFileSync(dir("prompt.md"), "Evening light over the old cafe.");
  fs.writeFileSync(dir("llm_notes.md"), "ЭТО НЕ ДОЛЖНО ПОПАСТЬ В МОДЕЛЬ");
  markAgentDone();
  reconcileStage(SHOT, STAGE);
  const file = readStageStateFile(SHOT, STAGE);
  assert.equal(file?.phase, "comfy");
  assert.ok(file?.jobId);
  assert.equal(readStageState(SHOT, STAGE).phase, "queued");
  const job = readComfyJob(file!.jobId!);
  const text = String(job?.prompt["100"].inputs.value);
  assert.match(text, /Evening light over the old cafe\./);
  assert.doesNotMatch(text, /НЕ ДОЛЖНО/);
});

test("ComfyUI принял задание → running; готово → idle и «на проверке»", () => {
  const jobId = readStageStateFile(SHOT, STAGE)!.jobId!;
  patchJob(jobId, { status: "running", promptId: "abc" });
  assert.equal(readStageState(SHOT, STAGE).phase, "running");
  assert.equal(readStageState(SHOT, STAGE).busy, true);
  patchJob(jobId, { status: "done", files: ["x.png"] });
  fs.writeFileSync(dir("output", "x.png"), PNG);
  reconcileStage(SHOT, STAGE);
  assert.equal(readStageStateFile(SHOT, STAGE)?.phase, "idle");
  assert.equal(deriveStageStatus(SHOT, STAGE, []), "review");
});

test("ошибка задания → error, этап свободен, сброс возвращает idle", async () => {
  const queued = queueStageRun(SHOT, STAGE);
  patchJob(queued.id, { status: "error", error: "node_errors KSampler" });
  reconcileStage(SHOT, STAGE);
  const state = readStageState(SHOT, STAGE);
  assert.equal(state.phase, "error");
  assert.equal(state.busy, false);
  assert.match(state.error || "", /KSampler/);
  await cancelStage(SHOT, STAGE);
  assert.equal(readStageState(SHOT, STAGE).phase, "idle");
});

test("отмена во время работы агента", async () => {
  sendToAgent();
  await cancelStage(SHOT, STAGE);
  assert.equal(readStageState(SHOT, STAGE).phase, "idle");
  assert.equal(readAgentRequest(SHOT, STAGE)?.status, "cancelled");
});

test("отмена задания, которое ещё не ушло в ComfyUI", async () => {
  const queued = queueStageRun(SHOT, STAGE);
  await cancelStage(SHOT, STAGE);
  assert.equal(readComfyJob(queued.id)?.status, "cancelled");
  assert.equal(readStageState(SHOT, STAGE).phase, "idle");
});

test("агент молчит дольше таймаута → error", () => {
  sendToAgent();
  const file = readStageStateFile(SHOT, STAGE)!;
  writeStageState(SHOT, STAGE, { ...file, since: "2000-01-01T00:00:00.000Z" });
  reconcileStage(SHOT, STAGE);
  const state = readStageState(SHOT, STAGE);
  assert.equal(state.phase, "error");
  assert.match(state.error || "", /не ответил/);
});
