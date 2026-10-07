// Действия «для всех кадров»: этап на всех кадрах, следующий этап каждого кадра, очередь агентов.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-bulk-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
process.env.FRAMEBOARD_AGENT_PARALLEL = "1";
delete process.env.SERIES_ROOT;
delete process.env.FRAMEBOARD_AGENT_PROVIDER;

import type { AgentResult } from "../contracts/agent-request";
import { liveRunCount } from "../agent/runner";
import { overrideAgentProvider } from "../agent/providers";
import { reconcileAllStages } from "./agent-dispatch";
import { readAgentRequest } from "./agent-request";
import { nextStage, runNextStageForAllShots, runNextStageForShot, runStageForAllShots } from "./bulk";
import { createEpisode, ensureStageDirs, shotDir, stageDir } from "./paths";
import { readShotMeta } from "./shot-meta";
import { readStageState } from "./stage-state";
import type { StageId } from "./constants";

const EP = "e01";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

function makeShot(shotId: string, shotMd: string) {
  fs.mkdirSync(shotDir(EP, shotId), { recursive: true });
  fs.writeFileSync(path.join(shotDir(EP, shotId), "shot.md"), shotMd);
  ensureStageDirs(EP, shotId);
}

function put(shotId: string, stageId: StageId, sub: string, name: string) {
  fs.writeFileSync(path.join(stageDir(EP, shotId, stageId), sub, name), PNG);
}

/** Провайдер, который отвечает, только когда тест разрешит. */
const gates: Array<() => void> = [];
overrideAgentProvider("claude", {
  id: "claude",
  label: "Claude (fake)",
  modes: ["text", "agent"],
  async check() {
    return { available: true };
  },
  run(): Promise<AgentResult> {
    return new Promise((resolve) => gates.push(() => resolve({ status: "done", prompt: "A wide view. No people." })));
  },
});

before(() => {
  createEpisode(EP);
  // s01: локация есть, общий вид в библиотеке — location можно запускать.
  makeShot("s01", "# Кафе\n\n- characters: katya\n- location: cafe\n");
  fs.mkdirSync(path.join(tmp, "locations", "cafe"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "locations", "cafe", "view.png"), PNG);
  // s02: без локации — этап location ему не нужен.
  makeShot("s02", "# Пустая улица\n\n- characters: \n- location: \n");
  // s03: локация уже утверждена.
  makeShot("s03", "# Холл\n\n- characters: lena\n- location: cafe\n");
  put("s03", "location", "approve", "hall.png");
  put("s03", "characters", "approve", "lena_s03.png");
  // s04: персонаж без локации — следующий этап персонажи.
  makeShot("s04", "# Портрет\n\n- characters: lena\n- location: \n");
});

after(() => {
  // Агенты, которых тест не дождался, иначе держат процесс до таймаута.
  while (gates.length) gates.shift()!();
  overrideAgentProvider("claude", null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("следующий этап: по порядку таблицы, ненужные этапы пропускаются", () => {
  assert.equal(nextStage(EP, "s01", readShotMeta(EP, "s01")), "characters");
  assert.equal(nextStage(EP, "s02", readShotMeta(EP, "s02")), "first_frame", "без персонажей и локации — сразу первый кадр");
  assert.equal(nextStage(EP, "s03", readShotMeta(EP, "s03")), "first_frame");
});

test("этап на всех кадрах: запуск, где можно, и причина, где нельзя", () => {
  const result = runStageForAllShots(EP, "location", { provider: "manual" });
  assert.deepEqual(result.started, [{ shotId: "s01", stageId: "location" }]);
  assert.deepEqual(
    result.skipped.map((item) => [item.shotId, item.reason]),
    [
      ["s02", "у кадра нет локации"],
      ["s03", "уже утверждено"],
      ["s04", "у кадра нет локации"],
    ],
  );
  assert.equal(readStageState(EP, "s01", "location").phase, "agent");
  assert.equal(readAgentRequest(EP, "s01", "location")?.provider, "manual");

  // Второй раз — этап уже занят.
  const again = runStageForAllShots(EP, "location", { provider: "manual" });
  assert.equal(again.started.length, 0);
  assert.match(again.skipped[0].reason, /этап занят/);
});

test("первый кадр без утверждённых входов — пропуск с подписью недостающего", () => {
  const result = runStageForAllShots(EP, "first_frame", { provider: "manual" });
  const s01 = result.skipped.find((item) => item.shotId === "s01");
  assert.match(s01?.reason ?? "", /не хватает: Утверждённая локация/);
});

test("пройденное не переделывается: результат в output/ — пропуск, с redo — запуск", () => {
  put("s01", "location", "output", "s01_v1.png");
  // s01 location занят прошлым тестом: сначала освобождаем.
  fs.rmSync(path.join(stageDir(EP, "s01", "location"), "stage_state.json"), { force: true });
  const skip = runStageForAllShots(EP, "location", { provider: "manual" });
  assert.match(skip.skipped.find((item) => item.shotId === "s01")?.reason ?? "", /уже есть результат/);
  const redo = runStageForAllShots(EP, "location", { provider: "manual", redo: true });
  assert.ok(redo.started.some((item) => item.shotId === "s01"));
  assert.ok(redo.started.some((item) => item.shotId === "s03"), "redo трогает и утверждённое");
});

test("кнопка на кадре: только этот кадр; кнопка сверху его потом не перезапускает", () => {
  const one = runNextStageForShot(EP, "s04", { provider: "manual" });
  assert.deepEqual(one.started, [{ shotId: "s04", stageId: "characters" }]);
  const all = runNextStageForAllShots(EP, { provider: "manual" });
  assert.match(all.skipped.find((item) => item.shotId === "s04")?.reason ?? "", /этап занят/);
  // Освобождаем s04 для следующего теста.
  fs.rmSync(path.join(stageDir(EP, "s04", "characters"), "stage_state.json"), { force: true });
  fs.rmSync(path.join(stageDir(EP, "s01", "characters"), "stage_state.json"), { force: true });
  // Прошлые запуски назначили кадрам агента «в чате»; дальше кадры без агента получают Claude.
  for (const shotId of ["s01", "s02", "s03", "s04"]) fs.rmSync(path.join(shotDir(EP, shotId), "agent.json"), { force: true });
});

test("агенты по кадрам: следующий этап каждого кадра, очередь из одного места", async () => {
  const result = runNextStageForAllShots(EP, { provider: "claude" });
  assert.deepEqual(
    result.started.map((item) => `${item.shotId}:${item.stageId}`).sort(),
    ["s01:characters", "s04:characters"],
  );
  const reasons = Object.fromEntries(result.skipped.map((item) => [item.shotId, item.reason]));
  assert.match(reasons.s02, /Первый кадр: не хватает/);
  assert.match(reasons.s03, /этап занят/, "s03 уже отдан агенту прошлыми тестами");

  // FRAMEBOARD_AGENT_PARALLEL=1: работает один агент, второй ждёт в pending.
  assert.equal(liveRunCount("claude"), 1);
  const statuses = () =>
    [readAgentRequest(EP, "s01", "characters")?.status, readAgentRequest(EP, "s04", "characters")?.status].sort();
  assert.deepEqual(statuses(), ["pending", "running"]);

  // Первый закончил — цикл запускает следующий.
  gates.shift()!();
  await new Promise((resolve) => setTimeout(resolve, 20));
  reconcileAllStages();
  assert.equal(liveRunCount("claude"), 1);
  assert.ok(statuses().includes("running"));
  gates.shift()!();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(liveRunCount("claude"), 0);
});
