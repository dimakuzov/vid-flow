// Агент кадра: agent.json, назначение массовыми кнопками, запуск каждого кадра его агентом, сводка таблицы.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-shot-agent-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
process.env.FRAMEBOARD_AGENT_PARALLEL = "4";
delete process.env.SERIES_ROOT;
delete process.env.FRAMEBOARD_AGENT_PROVIDER;

import type { AgentResult } from "../contracts/agent-request";
import { overrideAgentProvider } from "../agent/providers";
import { PUT as putShotAgent } from "../../app/api/episodes/[episodeId]/shots/[shotId]/agent/route";
import { POST as postAgentRequest } from "../../app/api/episodes/[episodeId]/shots/[shotId]/stages/[stage]/agent-request/route";
import { POST as postShotNext } from "../../app/api/episodes/[episodeId]/shots/[shotId]/next-stage/route";
import { cancelStage, stopAgentRuns } from "./agent-dispatch";
import { readAgentRequest } from "./agent-request";
import { assignShotAgents, runStageForAllShots } from "./bulk";
import { createEpisode, ensureStageDirs, shotDir } from "./paths";
import { scanSeries } from "./scanner";
import { readShotAgent, readShotAgentActivity, writeShotAgent } from "./shot-agent";
import { STAGES } from "./constants";
import { readStageStateFile } from "./stage-state";

const EP = "e01";
const SHOTS = ["s01", "s02", "s03"];
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const HAIKU = "claude-haiku-4-5-20251001";

/** Claude держит ответ, пока тест не отпустит; так видно «работает». */
const gates: Array<() => void> = [];
overrideAgentProvider("claude", {
  id: "claude",
  label: "Claude (fake)",
  modes: ["text", "agent"],
  configError: (model) => (!model || model.startsWith("claude-") ? null : `Неизвестная модель Claude: ${model}`),
  async check() {
    return { available: true };
  },
  run(): Promise<AgentResult> {
    return new Promise((resolve) => gates.push(() => resolve({ status: "done", prompt: "A wide view. No people." })));
  },
});

function shotApi(shotId: string) {
  return { params: Promise.resolve({ episodeId: EP, shotId }) };
}

function json(body: unknown) {
  return { method: "POST", body: JSON.stringify(body) };
}

async function freeAll() {
  for (const shotId of SHOTS) {
    for (const stageId of STAGES) {
      if (readStageStateFile(EP, shotId, stageId)?.phase !== "idle") await cancelStage(EP, shotId, stageId);
    }
  }
}

before(() => {
  createEpisode(EP);
  fs.mkdirSync(path.join(tmp, "locations", "cafe"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "locations", "cafe", "view.png"), PNG);
  for (const shotId of SHOTS) {
    fs.mkdirSync(shotDir(EP, shotId), { recursive: true });
    fs.writeFileSync(path.join(shotDir(EP, shotId), "shot.md"), `# ${shotId}\n\n- characters: \n- location: cafe\n`);
    ensureStageDirs(EP, shotId);
  }
});

after(() => {
  while (gates.length) gates.shift()!();
  overrideAgentProvider("claude", null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("agent.json: пишется и читается, неверный провайдер или модель — ошибка", () => {
  assert.equal(readShotAgent(EP, "s01"), null);
  const saved = writeShotAgent(EP, "s01", { provider: "claude", model: HAIKU });
  assert.deepEqual(readShotAgent(EP, "s01"), saved);
  assert.equal(saved.model, HAIKU);
  const raw = JSON.parse(fs.readFileSync(path.join(shotDir(EP, "s01"), "agent.json"), "utf8"));
  assert.equal(raw.provider, "claude");
  assert.throws(() => writeShotAgent(EP, "s01", { provider: "gpt" }), /Неизвестный провайдер/);
  assert.throws(() => writeShotAgent(EP, "s01", { provider: "claude", model: "gpt-4" }), /Неизвестная модель/);
  assert.throws(() => writeShotAgent(EP, "s09", { provider: "manual" }), /Кадра s09 нет/);
  assert.equal(readShotAgent(EP, "s01")?.model, HAIKU, "неудачная запись не трогает файл");
});

test("«Все кадры»: кадрам без агента назначается выбранный, каждый кадр идёт своим агентом", () => {
  const result = runStageForAllShots(EP, "location", { provider: "manual" });
  assert.deepEqual(result.assigned, ["s02", "s03"]);
  assert.deepEqual(result.started.map((item) => item.shotId), SHOTS);
  const s01 = readAgentRequest(EP, "s01", "location");
  assert.equal(s01?.provider, "claude", "у s01 свой агент");
  assert.equal(s01?.model, HAIKU);
  for (const shotId of ["s02", "s03"]) {
    assert.equal(readAgentRequest(EP, shotId, "location")?.provider, "manual");
    assert.equal(readShotAgent(EP, shotId)?.provider, "manual", `${shotId} получил агента`);
  }
  assert.equal(readShotAgent(EP, "s01")?.provider, "claude", "назначенный не меняется");
});

test("сводка таблицы: агент кадра и что он делает", () => {
  const shots = Object.fromEntries(scanSeries(EP).shots.map((shot) => [shot.id, shot]));
  assert.deepEqual(shots.s01.agent, { provider: "claude", model: HAIKU });
  assert.equal(shots.s01.agentActivity?.status, "running");
  assert.equal(shots.s01.agentActivity?.stageId, "location");
  assert.equal(shots.s01.agentActivity?.since, readAgentRequest(EP, "s01", "location")?.startedAt);
  assert.deepEqual(shots.s02.agent, { provider: "manual", model: null });
  assert.equal(shots.s01.agentActivity?.provider, "claude");
  assert.equal(shots.s02.agentActivity?.status, "queued", "ручной ждёт агента в чате");
  assert.equal(shots.s02.agentActivity?.provider, "manual");
});

test("остановка агента кадра: только этот кадр", async () => {
  const stopped = await stopAgentRuns({ episodeId: EP, shotId: "s01" });
  assert.deepEqual(stopped.map((run) => `${run.shotId}:${run.stageId}`), ["s01:location"]);
  assert.equal(readShotAgentActivity(EP, "s01"), null, "свободен");
  assert.equal(readAgentRequest(EP, "s02", "location")?.status, "pending", "чужой кадр не тронут");
});

test("«Агенты по кадрам» не меняет назначенных и ничего не запускает; без агента и без выбора — агент доски", async () => {
  await freeAll();
  fs.rmSync(path.join(shotDir(EP, "s03"), "agent.json"));
  const before = readAgentRequest(EP, "s03", "location")?.id;
  const result = assignShotAgents(EP, { provider: "claude", model: "claude-sonnet-5-5" });
  assert.deepEqual(result.assigned, ["s03"]);
  assert.deepEqual(result.started, []);
  assert.equal(readAgentRequest(EP, "s03", "location")?.id, before, "нового запроса нет");
  assert.equal(readShotAgent(EP, "s01")?.model, HAIKU);
  assert.equal(readShotAgent(EP, "s02")?.provider, "manual");
  assert.equal(readShotAgent(EP, "s03")?.model, "claude-sonnet-5-5");

  await freeAll();
  fs.rmSync(path.join(shotDir(EP, "s03"), "agent.json"));
  const fallback = runStageForAllShots(EP, "location");
  assert.deepEqual(fallback.assigned, []);
  assert.equal(readShotAgent(EP, "s03"), null);
  assert.equal(readAgentRequest(EP, "s03", "location")?.provider, "manual", "FRAMEBOARD_AGENT_PROVIDER не задан — manual");
});

test("меню кадра: «Сохранить» и «Запустить следующий этап» пишут агента кадра", async () => {
  await freeAll();
  const saved = await putShotAgent(
    new Request("http://x", { method: "PUT", body: JSON.stringify({ provider: "claude", model: "claude-sonnet-5-5" }) }),
    shotApi("s02"),
  );
  assert.equal(saved.status, 200);
  assert.equal(readShotAgent(EP, "s02")?.provider, "claude");
  const bad = await putShotAgent(new Request("http://x", { method: "PUT", body: JSON.stringify({ provider: "gpt" }) }), shotApi("s02"));
  assert.equal(bad.status, 400);

  const run = await postShotNext(new Request("http://x", json({ provider: "manual" })), shotApi("s02"));
  const body = (await run.json()) as { assigned: string[]; started: unknown[] };
  assert.deepEqual(body.assigned, ["s02"], "свой выбор в меню кадра заменяет агента");
  assert.equal(body.started.length, 1);
  assert.equal(readAgentRequest(EP, "s02", "location")?.provider, "manual");
});

test("страница этапа: другой агент на один раз; с галкой — запоминается для кадра", async () => {
  await freeAll();
  const stage = (shotId: string) => ({ params: Promise.resolve({ episodeId: EP, shotId, stage: "location" }) });
  const once = await postAgentRequest(new Request("http://x", json({ message: "Вечер", provider: "manual" })), stage("s01"));
  assert.equal(once.status, 200);
  assert.equal(readAgentRequest(EP, "s01", "location")?.provider, "manual");
  assert.equal(readShotAgent(EP, "s01")?.provider, "claude", "без галки агент кадра прежний");

  await freeAll();
  const remembered = await postAgentRequest(
    new Request("http://x", json({ message: "Вечер", provider: "manual", rememberForShot: true })),
    stage("s01"),
  );
  assert.equal(remembered.status, 200);
  assert.deepEqual(
    { provider: readShotAgent(EP, "s01")?.provider, model: readShotAgent(EP, "s01")?.model },
    { provider: "manual", model: null },
  );
});
