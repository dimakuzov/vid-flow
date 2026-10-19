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
import { readFormatRequest, writeFormatRequest } from "../series/format-request";
import { episodeRoot, listShotIds, prepareDataRoot, readCurrentEpisodeId } from "../series/paths";
import { readTextIfExists } from "../series/media";
import { readShotMeta } from "../series/shot-meta";
import { readShotSpeech } from "../series/speech";
import { readRunSettings } from "../series/run-settings";
import { readAgentRequest, submitAgentRequest } from "../series/agent-request";
import { createEpisode, ensureStageDirs, shotDir } from "../series/paths";
import { agentRunPromise } from "./runner";
import { abortFormatRun, buildFormatPrompt, FORMAT_STOPPED, isFormatRunLive, startFormatRun } from "./format-runner";
import { listAgentProviders, overrideAgentProvider } from "./providers";

const calls: AgentTask[] = [];
let reply: AgentResult = { status: "done", prompt: "" };
/** Держит ответ модели, пока тест не отпустит. hearsAbort — провайдер падает по abort, как настоящий. */
let hold: { gate: Promise<void>; hearsAbort: boolean } | null = null;

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
    async run(task, signal) {
      calls.push(task);
      const current = hold;
      if (current) {
        await new Promise<void>((resolve, reject) => {
          current.gate.then(resolve);
          if (current.hearsAbort) signal.addEventListener("abort", () => reject(signal.reason));
        });
      }
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
  assert.match(prompt.system, /не дели один прописанный кадр|Сцену не дробить/);
  assert.match(prompt.system, /Реплики копируй дословно/);
  assert.match(prompt.system, /название дословно/);
  assert.match(prompt.user, /персонажи: katya/);
  assert.match(prompt.user, /локации: cafe/);
  assert.match(prompt.user, /Катя входит в кафе\./);
});

test("новая серия: модель размечает, таблица собирается сама, серия открыта", async () => {
  reply = {
    status: "done",
    prompt: "```md\n# Тест\n\n## s01 Кафе\n- characters: katya\n- location: cafe\nКатя входит.\n\n## s02 Улица\n- characters: \n- location: \nПустая улица.\n```",
  };
  const res = await post({ episodeId: "e05", rawText: "Катя входит в кафе. Потом пустая улица.", provider: "claude", model: "claude-haiku-5-5" });
  assert.equal(res.status, 200);
  await settle("e05");
  assert.equal(calls.at(-1)?.request.model, "claude-haiku-5-5", "модель доходит до провайдера");
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
  reply = { status: "done", prompt: "A coat.", log: "ok" };
  const request = submitAgentRequest({
    episodeId: "e09",
    shotId: "s01",
    stageId: "characters",
    message: "Платье",
    prompt: "",
    refsNote: "",
    workflowNote: "",
    provider: "claude",
    model: "claude-haiku-5-5",
  });
  assert.equal(request.model, "claude-haiku-5-5");
  await agentRunPromise("e09", request.id);
  assert.equal(calls.at(-1)?.request.model, "claude-haiku-5-5");
  assert.equal(readAgentRequest("e09", "s01", "characters")?.status, "done");
});

test("список провайдеров отдаёт модели и модель по умолчанию", async () => {
  const claude = (await listAgentProviders()).find((item) => item.id === "claude");
  assert.deepEqual(claude?.models.map((item) => item.id), ["claude-sonnet-5-5"]);
  assert.equal(claude?.defaultModel, "claude-sonnet-5-5");
});

test("разметка с репликами и длительностью: speech.md кадра и длительность этапа видео", async () => {
  reply = {
    status: "done",
    prompt:
      "# Тест\n\n## s01 Кафе\n- characters: katya\n- location: cafe\n- duration: 7\n- speech: Катя: Мама, я дома.\n- speech: Мама: Иди ужинать.\nКатя входит.\n\n## s02 Улица\n- characters: \n- location: \n- duration: 30\nПустая улица.\n",
  };
  await post({ episodeId: "e10", rawText: "Катя входит: «Мама, я дома». Мама: «Иди ужинать». Пустая улица.", provider: "claude" });
  await settle("e10");
  assert.equal(readFormatRequest(episodeRoot("e10"))?.status, "done");
  assert.equal(readShotSpeech("e10", "s01"), "Катя: Мама, я дома.\nМама: Иди ужинать.\n");
  assert.equal(readShotMeta("e10", "s01").summary, "Катя входит.", "реплики не попадают в действие");
  assert.equal(readRunSettings("e10", "s01", "video_preview").durationSec, 7);
  assert.equal(readShotSpeech("e10", "s02"), "", "без реплик файла нет");
  assert.equal(readRunSettings("e10", "s02", "video_preview").durationSec, 12, "больше 12 — до предела");
  assert.match(buildFormatPrompt("x").system, /- speech: /);
});

test("разметка не подменяет название сцены и не меняет реплики местами", async () => {
  reply = {
    status: "done",
    prompt: `# Ep

## s01 Ужин
- characters: lena, mama
- location: kitchen
- duration: 6
- speech: MAMA: Иди ужинать.
- speech: LENA: Мама, я дома.
Лена дома.

## s02 Лишнее
Ещё кадр.
`,
  };
  await post({
    episodeId: "e20",
    rawText: `Episode
1. ИНТ. Кухня — вечер
LENA
Мама, я дома.
MAMA
Иди ужинать.
2. НАТ. Улица — ночь
Пустая улица.
`,
    provider: "claude",
  });
  await settle("e20");
  assert.equal(readFormatRequest(episodeRoot("e20"))?.status, "done");
  assert.deepEqual(listShotIds("e20"), ["s01", "s02"]);
  assert.equal(readShotMeta("e20", "s01").title, "ИНТ. Кухня — вечер");
  assert.equal(readShotMeta("e20", "s02").title, "НАТ. Улица — ночь");
  assert.equal(readShotSpeech("e20", "s01"), "LENA: Мама, я дома.\nMAMA: Иди ужинать.\n");
  assert.match(calls.at(-1)?.user ?? "", /s01: ИНТ\. Кухня — вечер/);
});

const ONE_SHOT = "## s01 Кафе\n- characters: katya\n- location: cafe\nКатя входит.";

function holdModel(hearsAbort: boolean): () => void {
  let open!: () => void;
  hold = { gate: new Promise<void>((resolve) => (open = resolve)), hearsAbort };
  return () => {
    hold = null;
    open();
  };
}

function pendingFormat(episodeId: string) {
  createEpisode(episodeId);
  fs.writeFileSync(path.join(episodeRoot(episodeId), "scenario_raw.md"), "Катя входит в кафе.");
  writeFormatRequest({ status: "pending", createdAt: new Date().toISOString(), episodeId, provider: "claude" });
}

test("остановка разметки: живой прогон получает abort, запрос — error, таблица пустая", async () => {
  const release = holdModel(true);
  try {
    reply = { status: "done", prompt: ONE_SHOT };
    pendingFormat("e11");
    const run = startFormatRun("e11");
    assert.ok(run);
    assert.equal(readFormatRequest(episodeRoot("e11"))?.status, "running");
    assert.equal(abortFormatRun("e11"), true);
    assert.equal(isFormatRunLive("e11"), false, "сразу уходит из живых");
    await run;
    const request = readFormatRequest(episodeRoot("e11"));
    assert.equal(request?.status, "error");
    assert.equal(request?.error, FORMAT_STOPPED);
    assert.deepEqual(listShotIds("e11"), []);
    assert.equal(abortFormatRun("e11"), false, "второй раз останавливать нечего");
  } finally {
    release();
  }
});

test("остановка разметки: ответ модели после остановки не применяется", async () => {
  const release = holdModel(false);
  reply = { status: "done", prompt: ONE_SHOT };
  pendingFormat("e12");
  const run = startFormatRun("e12");
  assert.equal(abortFormatRun("e12"), true);
  release();
  await run;
  assert.equal(readFormatRequest(episodeRoot("e12"))?.error, FORMAT_STOPPED);
  assert.deepEqual(listShotIds("e12"), [], "таблица не собрана");
  assert.doesNotMatch(readTextIfExists(path.join(episodeRoot("e12"), "scenario.md")), /## s01/);
});

test("остановка разметки: ждущий запрос больше не запустится, manual не трогается", () => {
  pendingFormat("e13");
  assert.equal(abortFormatRun("e13"), true);
  assert.equal(readFormatRequest(episodeRoot("e13"))?.status, "error");
  assert.equal(startFormatRun("e13"), null);

  writeFormatRequest({ status: "pending", createdAt: new Date().toISOString(), episodeId: "e13", provider: "manual" });
  assert.equal(abortFormatRun("e13"), false);
  assert.equal(readFormatRequest(episodeRoot("e13"))?.status, "pending");
});
