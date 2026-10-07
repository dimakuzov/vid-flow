// «Добавить» в шапке: разметка сценария моделью доски и сборка таблицы; модель доходит до провайдера.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-format-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;
delete process.env.FRAMEBOARD_AGENT_PROVIDER;

import type { AgentResult, AgentTask } from "../contracts/agent-request";
import { POST as postNewEpisode } from "../../app/api/series/new-episode/route";
import { readFormatRequest } from "../series/format-request";
import { episodeRoot, listShotIds, prepareDataRoot, readCurrentEpisodeId } from "../series/paths";
import { readShotMeta } from "../series/shot-meta";
import { readAgentRequest, submitAgentRequest } from "../series/agent-request";
import { createEpisode, ensureStageDirs, shotDir } from "../series/paths";
import { agentRunPromise } from "./runner";
import { buildFormatPrompt, isFormatRunLive, startFormatRun } from "./format-runner";
import { listAgentProviders, overrideAgentProvider } from "./providers";

const calls: AgentTask[] = [];
let reply: AgentResult = { status: "done", prompt: "" };

before(() => {
  prepareDataRoot();
  fs.mkdirSync(path.join(tmp, "characters", "katya"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "locations", "cafe"), { recursive: true });
  overrideAgentProvider("claude", {
    id: "claude",
    label: "Claude Code (fake)",
    modes: ["text", "agent"],
    configError: (model) => (!model || model.startsWith("claude-") ? null : `Неизвестная модель Claude: ${model}`),
    async check() {
      return { available: true, models: [{ id: "claude-sonnet-5-5", label: "Sonnet 5.5" }], defaultModel: "claude-sonnet-5-5" };
    },
    async run(task) {
      calls.push(task);
      return reply;
    },
  });
});

after(() => {
  overrideAgentProvider("claude", null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

function post(body: unknown) {
  return postNewEpisode(new Request("http://board/api/series/new-episode", { method: "POST", body: JSON.stringify(body) }));
}

async function settle(episodeId: string) {
  for (let i = 0; i < 50 && isFormatRunLive(episodeId); i += 1) await new Promise((r) => setTimeout(r, 10));
}

test("подсказка модели: правила разметки, библиотека персонажей и локаций, сырой текст", () => {
  const prompt = buildFormatPrompt("Катя входит в кафе.");
  assert.match(prompt.system, /## s01/);
  assert.match(prompt.user, /персонажи: katya/);
  assert.match(prompt.user, /локации: cafe/);
  assert.match(prompt.user, /Катя входит в кафе\./);
});

test("новая серия: модель размечает, таблица собирается сама, серия открыта", async () => {
  reply = {
    status: "done",
    prompt: "```md\n# Тест\n\n## s01 Кафе\n- characters: katya\n- location: cafe\nКатя входит.\n\n## s02 Улица\n- characters: \n- location: \nПустая улица.\n```",
  };
  const res = await post({ episodeId: "e05", rawText: "Катя входит в кафе. Потом пустая улица.", provider: "claude", model: "claude-haiku-4-5-20251001" });
  assert.equal(res.status, 200);
  await settle("e05");
  assert.equal(calls.at(-1)?.request.model, "claude-haiku-4-5-20251001", "модель доходит до провайдера");
  const request = readFormatRequest(episodeRoot("e05"));
  assert.equal(request?.status, "done");
  assert.equal(request?.shots, 2);
  assert.deepEqual(listShotIds("e05"), ["s01", "s02"]);
  assert.deepEqual(readShotMeta("e05", "s01").characters, ["katya"]);
  assert.equal(readCurrentEpisodeId(), "e05");
  const inbox = fs.readFileSync(path.join(episodeRoot("e05"), "agent_inbox.md"), "utf8");
  assert.doesNotMatch(inbox, /format-scenario/, "разметку моделью не ждут во входящих агента");
});

test("модель не вернула кадров — понятная ошибка, таблица не трогается", async () => {
  reply = { status: "done", prompt: "Извините, не понял сценарий." };
  await post({ episodeId: "e06", rawText: "Что-то.", provider: "claude" });
  await settle("e06");
  const request = readFormatRequest(episodeRoot("e06"));
  assert.equal(request?.status, "error");
  assert.match(request?.error ?? "", /не вернула кадров/);
  assert.deepEqual(listShotIds("e06"), []);
});

test("сценарий из библиотеки data/scenarios/, неизвестная модель — 400", async () => {
  fs.writeFileSync(path.join(tmp, "scenarios", "teaser.md"), "Катя входит в кафе.");
  reply = { status: "done", prompt: "## s01 Кафе\n- characters: katya\n- location: cafe\nКатя входит." };
  assert.equal((await post({ episodeId: "e07", scenarioFile: "teaser.md", provider: "claude" })).status, 200);
  await settle("e07");
  assert.match(calls.at(-1)?.user ?? "", /Катя входит в кафе\./);
  assert.equal((await post({ episodeId: "e08", rawText: "x", provider: "claude", model: "gpt-4" })).status, 400);
  assert.equal(startFormatRun("e08"), null);
});

test("запрос агенту хранит выбранную модель, провайдер её получает", async () => {
  createEpisode("e09");
  fs.mkdirSync(shotDir("e09", "s01"), { recursive: true });
  fs.writeFileSync(path.join(shotDir("e09", "s01"), "shot.md"), "# Кафе\n\n- characters: katya\n- location: \n");
  ensureStageDirs("e09", "s01");
  reply = { status: "done", log: "ok" };
  const request = submitAgentRequest({
    episodeId: "e09",
    shotId: "s01",
    stageId: "characters",
    message: "Платье",
    prompt: "",
    refsNote: "",
    workflowNote: "",
    provider: "claude",
    model: "claude-haiku-4-5-20251001",
  });
  assert.equal(request.model, "claude-haiku-4-5-20251001");
  await agentRunPromise("e09", request.id);
  assert.equal(calls.at(-1)?.request.model, "claude-haiku-4-5-20251001");
  assert.equal(readAgentRequest("e09", "s01", "characters")?.status, "done");
});

test("список провайдеров отдаёт модели и модель по умолчанию", async () => {
  const claude = (await listAgentProviders()).find((item) => item.id === "claude");
  assert.deepEqual(claude?.models.map((item) => item.id), ["claude-sonnet-5-5"]);
  assert.equal(claude?.defaultModel, "claude-sonnet-5-5");
});
