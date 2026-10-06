// Запуск: node --import tsx --test src/lib/agent/runner.test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-agent-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
delete process.env.SERIES_ROOT;
delete process.env.FRAMEBOARD_AGENT_PROVIDER;
process.env.FRAMEBOARD_LOOPS = "off";
process.env.FRAMEBOARD_OLLAMA_MODEL = "fake-model";

import type { AgentResult, AgentTask } from "../contracts/agent-request";
import { POST as postAgentRequest } from "../../app/api/episodes/[episodeId]/shots/[shotId]/stages/[stage]/agent-request/route";
import { cancelStage, reconcileStage, RESTARTED_ERROR } from "../series/agent-dispatch";
import { readAgentRequest, readLlmTask, submitAgentRequest } from "../series/agent-request";
import { createEpisode, ensureStageDirs, shotDir, stageDir } from "../series/paths";
import { readStageState, readStageStateFile } from "../series/stage-state";
import type { StageId } from "../series/constants";
import { agentRunPromise, isAgentRunLive } from "./runner";
import { cleanPromptText, getAgentProvider, listAgentProviders, overrideAgentProvider, type BoardAgentProvider } from "./providers";
import { runProcess } from "./process";

const EP = "e01";
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

function file(shot: string, stage: StageId, ...parts: string[]): string {
  return path.join(stageDir(EP, shot, stage), ...parts);
}

function fake(
  id: "ollama" | "claude",
  run: (task: AgentTask, signal: AbortSignal) => Promise<AgentResult>,
): { calls: AgentTask[] } {
  const calls: AgentTask[] = [];
  const provider: BoardAgentProvider = {
    id,
    label: id === "ollama" ? "Ollama (fake)" : "Claude (fake)",
    modes: id === "ollama" ? ["text"] : ["text", "agent"],
    async check() {
      return { available: true };
    },
    run(task, signal) {
      calls.push(task);
      return run(task, signal);
    },
  };
  overrideAgentProvider(id, provider);
  return { calls };
}

function send(shot: string, stage: StageId, provider?: string, message = "Сделай вечер") {
  return submitAgentRequest({
    episodeId: EP,
    shotId: shot,
    stageId: stage,
    message,
    prompt: "Old cafe, day.",
    refsNote: "",
    workflowNote: "",
    provider,
  });
}

async function settle(requestId: string) {
  await agentRunPromise(EP, requestId);
}

function makeShot(shot: string, body: string) {
  fs.mkdirSync(shotDir(EP, shot), { recursive: true });
  fs.writeFileSync(path.join(shotDir(EP, shot), "shot.md"), body);
  ensureStageDirs(EP, shot);
}

before(() => {
  createEpisode(EP);
  makeShot("s01", "# Кафе\n\n- characters: katya\n- location: cafe\n\nКатя входит в кафе и садится у окна.\n");
  fs.writeFileSync(file("s01", "location", "refs", "view.png"), PNG);
  makeShot("s02", "# Улица\n\n- characters: katya\n- location: street\n\nКатя идёт по улице.\n");
});

beforeEach(async () => {
  overrideAgentProvider("ollama", null);
  overrideAgentProvider("claude", null);
  delete process.env.FRAMEBOARD_AGENT_TEXT_TIMEOUT_MIN;
  for (const shot of ["s01", "s02"]) {
    for (const stage of ["location", "characters"] as StageId[]) {
      if (readStageStateFile(EP, shot, stage)?.phase !== "idle") await cancelStage(EP, shot, stage);
    }
  }
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("text: ответ провайдера → prompt.md, история, baseline, done; цикл ставит в очередь", async () => {
  const { calls } = fake("ollama", async () => ({ status: "done", prompt: "```\nEvening light over the old cafe.\n```" }));
  const request = send("s01", "location", "ollama");
  assert.equal(request.mode, "text");
  assert.equal(readAgentRequest(EP, "s01", "location")?.status, "running");
  await settle(request.id);

  assert.equal(fs.readFileSync(file("s01", "location", "prompt.md"), "utf8").trim(), "Evening light over the old cafe.");
  const history = JSON.parse(fs.readFileSync(file("s01", "location", "prompt_history.json"), "utf8"));
  assert.ok(JSON.stringify(history).includes("Old cafe, day."), "старый промпт в истории");
  const baseline = JSON.parse(fs.readFileSync(file("s01", "location", "agent_baseline.json"), "utf8"));
  assert.match(baseline.prompt, /Evening light/);
  assert.equal(baseline.refs[0].name, "view.png");
  const done = readAgentRequest(EP, "s01", "location")!;
  assert.equal(done.status, "done");
  assert.ok(done.finishedAt);

  const task = calls[0];
  assert.match(task.system, /Reply with the complete new text of prompt\.md/);
  assert.match(task.system, /playbooks\/models\/qwen_location\.en\.md/);
  assert.match(task.user, /Сделай вечер/);
  assert.match(task.user, /Катя входит в кафе/);
  assert.match(task.user, /view\.png/);
  assert.match(task.user, /katya/);

  reconcileStage(EP, "s01", "location");
  assert.equal(readStageStateFile(EP, "s01", "location")?.phase, "comfy");
  assert.equal(readStageState(EP, "s01", "location").phase, "queued");
});

test("ошибка провайдера → запрос error → фаза error с текстом", async () => {
  fake("ollama", async () => {
    throw new Error("connection refused");
  });
  const request = send("s01", "location", "ollama");
  await settle(request.id);
  assert.equal(readAgentRequest(EP, "s01", "location")?.status, "error");
  reconcileStage(EP, "s01", "location");
  const state = readStageState(EP, "s01", "location");
  assert.equal(state.phase, "error");
  assert.match(state.error || "", /connection refused/);
});

test("пустой ответ → error", async () => {
  fake("ollama", async () => ({ status: "done", prompt: "  " }));
  const request = send("s01", "location", "ollama");
  await settle(request.id);
  assert.match(readAgentRequest(EP, "s01", "location")?.error || "", /пуст/);
});

test("отмена во время running прерывает провайдера и не пишет результат", async () => {
  let aborted = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  fake("ollama", async (_task, signal) => {
    signal.addEventListener("abort", () => (aborted = true));
    await gate;
    return { status: "done", prompt: "SHOULD NOT BE WRITTEN" };
  });
  const request = send("s01", "location", "ollama");
  assert.equal(isAgentRunLive(EP, request.id), true);
  await cancelStage(EP, "s01", "location");
  release();
  await settle(request.id);

  assert.equal(aborted, true);
  assert.equal(readAgentRequest(EP, "s01", "location")?.status, "cancelled");
  assert.equal(fs.readFileSync(file("s01", "location", "prompt.md"), "utf8"), "Old cafe, day.");
  assert.equal(readStageState(EP, "s01", "location").phase, "idle");
  reconcileStage(EP, "s01", "location");
  assert.equal(readStageState(EP, "s01", "location").phase, "idle");
});

test("таймаут text-режима → error, даже если провайдер не слушает signal", async () => {
  process.env.FRAMEBOARD_AGENT_TEXT_TIMEOUT_MIN = String(50 / 60000);
  fake("ollama", () => new Promise(() => undefined));
  const request = send("s01", "location", "ollama");
  await settle(request.id);
  const stored = readAgentRequest(EP, "s01", "location")!;
  assert.equal(stored.status, "error");
  assert.match(stored.error || "", /не ответил/);
  reconcileStage(EP, "s01", "location");
  assert.equal(readStageState(EP, "s01", "location").phase, "error");
});

test("running без исполнителя (доска перезапущена) → error", () => {
  const request = send("s01", "location"); // manual: файл запроса без исполнителя
  const stored = readAgentRequest(EP, "s01", "location")!;
  fs.writeFileSync(
    file("s01", "location", "agent_request.json"),
    JSON.stringify({ ...stored, provider: "ollama", mode: "text", status: "running", startedAt: new Date().toISOString() }),
  );
  assert.equal(isAgentRunLive(EP, request.id), false);
  reconcileStage(EP, "s01", "location");
  const state = readStageState(EP, "s01", "location");
  assert.equal(state.phase, "error");
  assert.equal(state.error, RESTARTED_ERROR);
});

test("pending у провайдера доски без исполнителя — цикл запускает его", async () => {
  fake("ollama", async () => ({ status: "done", prompt: "From the loop." }));
  send("s01", "location");
  const stored = readAgentRequest(EP, "s01", "location")!;
  fs.writeFileSync(
    file("s01", "location", "agent_request.json"),
    JSON.stringify({ ...stored, provider: "ollama", mode: "text" }),
  );
  reconcileStage(EP, "s01", "location");
  assert.equal(readAgentRequest(EP, "s01", "location")?.status, "running");
  await settle(stored.id);
  assert.equal(readAgentRequest(EP, "s01", "location")?.status, "done");
  assert.equal(fs.readFileSync(file("s01", "location", "prompt.md"), "utf8").trim(), "From the loop.");
});

test("agent: этап без воркфлоу доски, вывод в run_log.md, done → idle", async () => {
  const { calls } = fake("claude", async () => ({ status: "done", log: "→ Write\nСделал katya_s02.png" }));
  const request = send("s02", "characters", "claude", "Катя в пальто");
  assert.equal(request.mode, "agent");
  await settle(request.id);
  assert.equal(calls[0].mode, "agent");
  assert.match(calls[0].taskMarkdown, /Катя в пальто/);
  assert.match(fs.readFileSync(file("s02", "characters", "run_log.md"), "utf8"), /katya_s02\.png/);
  reconcileStage(EP, "s02", "characters");
  assert.equal(readStageStateFile(EP, "s02", "characters")?.phase, "idle");
});

test("неподходящий провайдер для режима → 400 с понятным текстом, запрос не записан", async () => {
  const previous = readAgentRequest(EP, "s02", "characters")?.id;
  const response = await postAgentRequest(
    new Request("http://x/api", {
      method: "POST",
      body: JSON.stringify({ message: "пальто", provider: "ollama" }),
    }),
    { params: Promise.resolve({ episodeId: EP, shotId: "s02", stage: "characters" }) },
  );
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /не подходит для этапа characters/);
  assert.equal(readAgentRequest(EP, "s02", "characters")?.id, previous);
  assert.equal(readStageState(EP, "s02", "characters").phase, "idle");

  const unknown = await postAgentRequest(
    new Request("http://x/api", { method: "POST", body: JSON.stringify({ provider: "gpt" }) }),
    { params: Promise.resolve({ episodeId: EP, shotId: "s01", stage: "location" }) },
  );
  assert.equal(unknown.status, 400);
});

test("ollama без модели → 400 до записи запроса", () => {
  const saved = process.env.FRAMEBOARD_OLLAMA_MODEL;
  delete process.env.FRAMEBOARD_OLLAMA_MODEL;
  try {
    assert.throws(() => send("s01", "location", "ollama"), /FRAMEBOARD_OLLAMA_MODEL/);
    assert.equal(readStageState(EP, "s01", "location").phase, "idle");
  } finally {
    process.env.FRAMEBOARD_OLLAMA_MODEL = saved;
  }
});

test("llm_task.md самодостаточен: действие кадра, без файлов доски; agent_request.md нет; во входящих только manual", () => {
  fs.writeFileSync(file("s01", "location", "agent_request.md"), "old");
  send("s01", "location");
  const task = readLlmTask(EP, "s01", "location");
  assert.match(task, /Катя входит в кафе/);
  assert.match(task, /Сделай вечер/);
  assert.match(task, /location_views/);
  assert.match(task, /"status": "done"/);
  assert.doesNotMatch(task, /status\.json|stage_state|llm_notes|agent_request\.md/);
  assert.equal(fs.existsSync(file("s01", "location", "agent_request.md")), false);
  const inbox = fs.readFileSync(path.join(tmp, "episodes", EP, "agent_inbox.md"), "utf8");
  assert.match(inbox, /shots\/s01\/location\/llm_task\.md/);
});

test("cleanPromptText снимает ``` и <think>", () => {
  assert.equal(cleanPromptText("<think>hmm</think>\n```text\nA cafe.\n```"), "A cafe.");
  assert.equal(cleanPromptText("A cafe."), "A cafe.");
});

test("провайдер ollama: POST /api/chat, ответ из message.content, abort обрывает запрос", async () => {
  let body: { model?: string; stream?: boolean; messages?: Array<{ role: string }> } = {};
  let hang = false;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (req.url === "/api/tags") {
        res.end(JSON.stringify({ models: [{ name: "fake-model:latest" }] }));
        return;
      }
      body = JSON.parse(raw);
      if (hang) return;
      res.end(JSON.stringify({ message: { content: "Night cafe, rain." } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  process.env.FRAMEBOARD_OLLAMA_URL = `http://127.0.0.1:${port}`;
  try {
    const ollama = getAgentProvider("ollama");
    assert.deepEqual(await ollama.check(), { available: true });
    const task = { system: "S", user: "U", mode: "text" } as AgentTask;
    const result = await ollama.run(task, new AbortController().signal);
    assert.deepEqual(result, { status: "done", prompt: "Night cafe, rain." });
    assert.equal(body.model, "fake-model");
    assert.equal(body.stream, false);
    assert.deepEqual(body.messages?.map((m) => m.role), ["system", "user"]);

    hang = true;
    const controller = new AbortController();
    const pending = ollama.run(task, controller.signal);
    setTimeout(() => controller.abort(new Error("stop")), 30);
    await assert.rejects(pending);

    const infos = await listAgentProviders();
    assert.deepEqual(infos.map((p) => p.id), ["manual", "ollama", "claude"]);
    assert.equal(infos.find((p) => p.id === "manual")?.isDefault, true);
    assert.equal(infos.find((p) => p.id === "ollama")?.available, true);
  } finally {
    server.closeAllConnections();
    server.close();
    delete process.env.FRAMEBOARD_OLLAMA_URL;
  }
});

test("провайдер claude: нет CLI — честно «не найден»", async () => {
  process.env.FRAMEBOARD_CLAUDE_BIN = path.join(tmp, "no-such-claude");
  try {
    const checked = await getAgentProvider("claude").check();
    assert.equal(checked.available, false);
    assert.match(checked.reason || "", /FRAMEBOARD_CLAUDE_BIN/);
  } finally {
    delete process.env.FRAMEBOARD_CLAUDE_BIN;
  }
});

test("runProcess: abort убивает процесс с дочерними", async () => {
  const marker = path.join(tmp, "child-alive.txt");
  const child = path.join(tmp, "child.js");
  const parent = path.join(tmp, "parent.js");
  fs.writeFileSync(child, `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(marker)}, "x"), 1500);`);
  fs.writeFileSync(
    parent,
    `require("child_process").spawn(process.execPath, [${JSON.stringify(child)}], { stdio: "ignore" });
setTimeout(() => {}, 60000);`,
  );
  const controller = new AbortController();
  const started = Date.now();
  const pending = runProcess(process.execPath, [parent], { cwd: tmp, signal: controller.signal });
  setTimeout(() => controller.abort(new Error("stop")), 300);
  await assert.rejects(pending, /stop/);
  assert.ok(Date.now() - started < 5000);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  assert.equal(fs.existsSync(marker), false, "дочерний процесс тоже убит");
});
