// Запуск: node --import tsx --test src/lib/agent/runs.test.ts
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-runs-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
delete process.env.SERIES_ROOT;
delete process.env.FRAMEBOARD_AGENT_PROVIDER;
delete process.env.FRAMEBOARD_AGENT_PARALLEL;
process.env.FRAMEBOARD_LOOPS = "off";
process.env.FRAMEBOARD_OLLAMA_MODEL = "fake-model";

import type { AgentResult, AgentTask } from "../contracts/agent-request";
import { GET as getRuns } from "../../app/api/agent/runs/route";
import { POST as postStop } from "../../app/api/agent/runs/stop/route";
import { cancelStage, type AgentRunEntry, type AgentRunsSummary } from "../series/agent-dispatch";
import { readAgentRequest, submitAgentRequest } from "../series/agent-request";
import { writeFormatRequest } from "../series/format-request";
import { createEpisode, ensureStageDirs, shotDir } from "../series/paths";
import { readStageState, readStageStateFile } from "../series/stage-state";
import { agentRunPromise } from "./runner";
import { overrideAgentProvider } from "./providers";

const EP = "e01";
const SCRIPT = path.resolve(__dirname, "../../../scripts/frameboard-status.mjs");
const SHOTS = ["s01", "s02", "s03"];
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

let release: () => void = () => undefined;
let aborted: string[] = [];

/** Медленный Ollama: держит запрос, пока тест не отпустит. Одно место (parallel 1) — второй ждёт. */
function slowOllama() {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  release = open;
  overrideAgentProvider("ollama", {
    id: "ollama",
    label: "Ollama (fake)",
    modes: ["text"],
    async check() {
      return { available: true };
    },
    async run(task: AgentTask, signal: AbortSignal): Promise<AgentResult> {
      signal.addEventListener("abort", () => aborted.push(task.request.shotId));
      await gate;
      return { status: "done", prompt: "Slow answer." };
    },
  });
}

function send(shot: string, provider = "ollama") {
  return submitAgentRequest({
    episodeId: EP,
    shotId: shot,
    stageId: "location",
    message: "Сделай вечер",
    prompt: "Old cafe, day.",
    refsNote: "",
    workflowNote: "",
    provider,
  });
}

async function runs(): Promise<AgentRunsSummary> {
  return (await (await getRuns()).json()) as AgentRunsSummary;
}

async function stop(body: unknown) {
  const response = await postStop(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }));
  return {
    status: response.status,
    body: (await response.json()) as AgentRunsSummary & { stopped: AgentRunEntry[]; error?: string },
  };
}

function statusLine(port: number): Promise<{ stdout: string; ms: number }> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [SCRIPT],
      { env: { ...process.env, FRAMEBOARD_PORT: String(port) }, timeout: 5000 },
      (error, stdout) => (error ? reject(error) : resolve({ stdout, ms: Date.now() - started })),
    );
    child.stdin!.end(JSON.stringify({ session_id: "x", model: { display_name: "Opus" } }));
  });
}

async function serve(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as { port: number }).port,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

before(() => {
  createEpisode(EP);
  for (const shot of SHOTS) {
    fs.mkdirSync(shotDir(EP, shot), { recursive: true });
    fs.writeFileSync(path.join(shotDir(EP, shot), "shot.md"), `# ${shot}\n\n- location: cafe\n\nКафе.\n`);
    ensureStageDirs(EP, shot);
    // С референсом у локации есть воркфлоу доски: Ollama работает в режиме text.
    fs.writeFileSync(path.join(shotDir(EP, shot), "location", "refs", "view.png"), PNG);
  }
});

beforeEach(async () => {
  release();
  aborted = [];
  for (const shot of SHOTS) {
    if (readStageStateFile(EP, shot, "location")?.phase !== "idle") await cancelStage(EP, shot, "location");
  }
  fs.rmSync(path.join(tmp, "episodes", EP, "format_request.json"), { force: true });
  slowOllama();
});

after(() => {
  release();
  overrideAgentProvider("ollama", null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("GET /api/agent/runs: один работает, один ждёт места, ручной не в списке", async () => {
  const first = send("s01");
  const second = send("s02");
  send("s03", "manual");
  assert.equal(readAgentRequest(EP, "s01", "location")?.status, "running");
  assert.equal(readAgentRequest(EP, "s02", "location")?.status, "pending");

  const { running, queued } = await runs();
  assert.equal(running.length, 1);
  assert.deepEqual(running[0], {
    kind: "stage",
    episodeId: EP,
    shotId: "s01",
    stageId: "location",
    provider: "ollama",
    model: "fake-model",
    since: readAgentRequest(EP, "s01", "location")?.startedAt,
  });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].shotId, "s02");
  assert.equal(queued[0].since, second.createdAt);

  release();
  await agentRunPromise(EP, first.id);
  const afterDone = await runs();
  assert.equal(afterDone.running.length, 0, "закончившийся прогон уходит из списка");
  assert.equal(afterDone.queued.length, 1, "второй ждёт фоновый цикл");
});

test("разметка сценария: pending у провайдера доски — в очереди, manual — нет", async () => {
  const createdAt = new Date().toISOString();
  writeFormatRequest({ status: "pending", createdAt, episodeId: EP, provider: "claude", model: "claude-haiku-4-5-20251001" });
  let { queued } = await runs();
  assert.deepEqual(queued, [
    {
      kind: "format",
      episodeId: EP,
      shotId: null,
      stageId: null,
      provider: "claude",
      model: "claude-haiku-4-5-20251001",
      since: createdAt,
    },
  ]);
  writeFormatRequest({ status: "pending", createdAt, episodeId: EP, provider: "manual" });
  ({ queued } = await runs());
  assert.equal(queued.length, 0);
});

test("POST /api/agent/runs/stop: один прогон — как «Отменить», остальные остаются", async () => {
  const first = send("s01");
  send("s02");
  const { status, body } = await stop({ episodeId: EP, shotId: "s01", stageId: "location" });
  assert.equal(status, 200);
  assert.deepEqual(body.stopped.map((run) => run.shotId), ["s01"]);
  assert.deepEqual(aborted, ["s01"], "провайдер получил abort");
  assert.equal(readAgentRequest(EP, "s01", "location")?.status, "cancelled");
  assert.equal(readStageState(EP, "s01", "location").phase, "idle");
  assert.equal(body.running.length, 0);
  assert.deepEqual(body.queued.map((run) => run.shotId), ["s02"]);

  release();
  await agentRunPromise(EP, first.id);
  assert.equal(fs.readFileSync(path.join(shotDir(EP, "s01"), "location", "prompt.md"), "utf8"), "Old cafe, day.");

  const nothing = await stop({ episodeId: EP, shotId: "s03", stageId: "location" });
  assert.equal(nothing.status, 200);
  assert.equal(nothing.body.stopped.length, 0);
});

test("POST /api/agent/runs/stop { all: true } снимает работающие и ждущие", async () => {
  send("s01");
  send("s02");
  const { status, body } = await stop({ all: true });
  assert.equal(status, 200);
  assert.deepEqual(body.stopped.map((run) => run.shotId).sort(), ["s01", "s02"]);
  assert.deepEqual(body.running, []);
  assert.deepEqual(body.queued, []);
  for (const shot of ["s01", "s02"]) {
    assert.equal(readAgentRequest(EP, shot, "location")?.status, "cancelled");
    assert.equal(readStageState(EP, shot, "location").phase, "idle");
  }
});

test("POST /api/agent/runs/stop: без цели или с чужим этапом — 400", async () => {
  assert.equal((await stop({})).status, 400);
  assert.equal((await stop({ episodeId: EP, shotId: "s01", stageId: "nope" })).status, 400);
  assert.equal((await stop({ episodeId: EP, shotId: "../x", stageId: "location" })).status, 400);
});

test("frameboard-status.mjs: числа, «агентов нет», таймаут и выключенная доска", async () => {
  let payload: unknown = { running: [{}, {}], queued: [{}, {}, {}] };
  let hang = false;
  const server = await serve((req, res) => {
    assert.equal(req.url, "/api/agent/runs");
    if (hang) return;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(payload));
  });
  try {
    assert.equal((await statusLine(server.port)).stdout, "Frameboard: 2 работают · 3 в очереди\n");
    payload = { running: [{}], queued: [] };
    assert.equal((await statusLine(server.port)).stdout, "Frameboard: 1 работает · 0 в очереди\n");
    payload = { running: [], queued: [] };
    assert.equal((await statusLine(server.port)).stdout, "Frameboard: агентов нет\n");

    hang = true;
    const slow = await statusLine(server.port);
    assert.equal(slow.stdout, "Frameboard: доска выключена\n");
    assert.ok(slow.ms < 3000, `таймаут 500 мс, а ждали ${slow.ms} мс`);
  } finally {
    server.close();
  }
  assert.equal((await statusLine(server.port)).stdout, "Frameboard: доска выключена\n");
});
