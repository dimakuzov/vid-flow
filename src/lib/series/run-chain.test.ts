// «▶ Все кадры» на эскизе: сначала LTX, после его прогона — MiniMax; агент знает, что промпт
// был под другой воркфлоу. Финал идёт за утверждённым эскизом. Провайдер подменён, ComfyUI нет.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-chain-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;
delete process.env.FRAMEBOARD_AGENT_PROVIDER;

import type { AgentRequestFile, AgentTask } from "../contracts/agent-request";
import { overrideAgentProvider } from "../agent/providers";
import { agentRunPromise } from "../agent/runner";
import { buildTextParts } from "../agent/task";
import { listWorkflowChoices } from "../comfy/workflows";
import { cancelStage, reconcileStage } from "./agent-dispatch";
import { readAgentDispatch, readAgentRequest, submitAgentRequest } from "./agent-request";
import { runStageForAllShots } from "./bulk";
import { createEpisode, ensureStageDirs, shotDir, stageDir } from "./paths";
import { readRunChain } from "./run-chain";
import { readShotNotes } from "./shot-notes";
import { readStageStateFile } from "./stage-state";

const EP = "e01";
const STAGE = "video_preview";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const tasks: AgentTask[] = [];

function put(file: string, bytes: Buffer = PNG) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function shot(shotId: string) {
  fs.mkdirSync(shotDir(EP, shotId), { recursive: true });
  fs.writeFileSync(path.join(shotDir(EP, shotId), "shot.md"), `# ${shotId}\n\n- characters: lena\n- location: park\n`);
  ensureStageDirs(EP, shotId);
  put(path.join(stageDir(EP, shotId, "first_frame"), "approve", `${shotId}_first.png`));
  put(path.join(stageDir(EP, shotId, "characters"), "approve", `lena_${shotId}.png`));
}

/** Задание очереди этапа закончилось в ComfyUI. */
function finishJob(shotId: string) {
  const jobId = readStageStateFile(EP, shotId, STAGE)?.jobId;
  assert.ok(jobId, "этап ушёл в очередь");
  const file = path.join(tmp, "comfy_queue", `${jobId}.json`);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...data, status: "done", files: ["x.mp4"] }));
}

async function agentDone(shotId: string) {
  const request = readAgentRequest(EP, shotId, STAGE)!;
  await agentRunPromise(EP, request.id);
  reconcileStage(EP, shotId, STAGE);
  return request;
}

before(() => {
  createEpisode(EP);
  overrideAgentProvider("claude", {
    id: "claude",
    label: "Claude (fake)",
    modes: ["text", "agent"],
    async check() {
      return { available: true };
    },
    async run(task) {
      tasks.push(task);
      const minimax = /video_minimax/.test(task.user);
      return {
        status: "done",
        prompt: minimax
          ? "subject_definitions ASTROCINEMAV01K2T:\n<Subject 1> is the young woman defined by <Picture 2>."
          : "use image as the first frame. The young woman walks away. Static camera.",
      };
    },
  });
});

after(() => {
  overrideAgentProvider("claude", null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("эскиз по умолчанию — LTX, MiniMax в меню", () => {
  shot("s01");
  const choices = listWorkflowChoices(EP, "s01", STAGE);
  assert.equal(choices.find((choice) => choice.isDefault)?.id, "video_ltx");
  assert.ok(choices.find((choice) => choice.id === "video_minimax")?.available);
});

test("«▶ Все кадры»: LTX, после прогона — MiniMax; агенту сказано, что промпт был под LTX", async () => {
  const result = runStageForAllShots(EP, STAGE, { provider: "claude", redo: true });
  assert.ok(result.started.some((item) => item.shotId === "s01"), JSON.stringify(result.skipped));
  assert.equal(readAgentDispatch(EP, "s01", STAGE)?.workflow, "video_ltx");
  assert.deepEqual(readRunChain(EP, "s01", STAGE)?.workflows, ["video_minimax"]);

  await agentDone("s01");
  assert.equal(readStageStateFile(EP, "s01", STAGE)?.phase, "comfy", "LTX ушёл в очередь");
  assert.equal(readAgentRequest(EP, "s01", STAGE)?.status, "done");

  finishJob("s01");
  reconcileStage(EP, "s01", STAGE);
  const second = readAgentRequest(EP, "s01", STAGE)!;
  assert.equal(readAgentDispatch(EP, "s01", STAGE)?.workflow, "video_minimax");
  assert.equal(readRunChain(EP, "s01", STAGE), null, "цепочка кончилась");
  assert.equal(readShotNotes(EP, "s01").length, 0, "шаги цепочки — не замечания пользователя");

  await agentRunPromise(EP, second.id);
  const user = tasks[tasks.length - 1].user;
  assert.match(user, /## The current prompt\.md was written for another workflow\n\nIt was written for `video_ltx`[^\n]*this run uses `video_minimax`/);
  assert.match(user, /- <Picture 1>: the approved first frame/);
  assert.match(fs.readFileSync(path.join(stageDir(EP, "s01", STAGE), "prompt.md"), "utf8"), /^subject_definitions ASTROCINEMAV01K2T:/);
});

test("сменил воркфлоу в меню и отправил без сообщения — агент переписывает под новый, правки помнит", async () => {
  shot("s02");
  fs.writeFileSync(path.join(stageDir(EP, "s02", STAGE), "prompt.md"), "");
  runStageForAllShots(EP, STAGE, { provider: "claude", redo: true });
  await agentDone("s02");
  await cancelStage(EP, "s02", STAGE);
  assert.equal(readRunChain(EP, "s02", STAGE), null, "«Отменить» обрывает цепочку");

  // Как страница этапа: выбор в меню уходит с запросом (runWorkflow), поле рекомендации пустое.
  const dir = stageDir(EP, "s02", STAGE);
  const request = submitAgentRequest({
    episodeId: EP,
    shotId: "s02",
    stageId: STAGE,
    message: "",
    prompt: fs.readFileSync(path.join(dir, "prompt.md"), "utf8"),
    refsNote: "",
    workflowNote: "",
    workflow: "video_minimax",
    provider: "claude",
  });
  await agentRunPromise(EP, request.id);
  const user = tasks[tasks.length - 1].user;
  assert.match(user, /written for `video_ltx`.*this run uses `video_minimax`/);
  assert.match(user, /Keep its content: the action, its order and timing, the spoken lines, and every correction from the user's notes/);
  assert.match(fs.readFileSync(path.join(dir, "prompt.md"), "utf8"), /^subject_definitions ASTROCINEMAV01K2T:/);
  // Промпт снова под тем воркфлоу, что выбран: следующий раз раздела о смене нет.
  assert.equal(buildTextParts({ ...request, createdAt: new Date().toISOString() } as AgentRequestFile).user.includes("written for another workflow"), false);
});

test("финал идёт за утверждённым эскизом: MiniMax → H3 Cinema, LTX → LTX", () => {
  shot("s03");
  const approve = path.join(stageDir(EP, "s03", STAGE), "approve");
  put(path.join(approve, "s03_h3_00001_.mp4"), Buffer.from("no metadata"));
  assert.equal(listWorkflowChoices(EP, "s03", "final_render").find((choice) => choice.isDefault)?.id, "final_h3_cinema");
  fs.rmSync(approve, { recursive: true, force: true });
  put(path.join(approve, "s03_ltx_00001_.mp4"), Buffer.from("no metadata"));
  assert.equal(listWorkflowChoices(EP, "s03", "final_render").find((choice) => choice.isDefault)?.id, "final_ltx");
});
