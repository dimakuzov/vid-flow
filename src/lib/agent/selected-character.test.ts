// Персонаж, выбранный на странице этапа «Персонажи», доходит до агента: и до текстового режима доски,
// и до задачи в llm_task.md. Без него агент угадывает по тексту кадра (в сценарии чаще назван другой).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-selected-character-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
delete process.env.SERIES_ROOT;
delete process.env.FRAMEBOARD_AGENT_PROVIDER;
process.env.FRAMEBOARD_LOOPS = "off";

import type { AgentTask } from "../contracts/agent-request";
import { readAgentRequest, readLlmTask, submitAgentRequest } from "../series/agent-request";
import { createEpisode, ensureStageDirs, shotDir } from "../series/paths";
import { agentRunPromise } from "./runner";
import { overrideAgentProvider } from "./providers";

const EP = "e01";

before(() => {
  createEpisode(EP);
  fs.mkdirSync(shotDir(EP, "s01"), { recursive: true });
  fs.writeFileSync(
    path.join(shotDir(EP, "s01"), "shot.md"),
    "# Гараж\n\n- characters: misha, man_ptu\n- location: garage\n\nМиша в синей куртке чинит мотоцикл, ученик заходит слева.\n",
  );
  ensureStageDirs(EP, "s01");
});

function submit(provider: string, character?: string) {
  return submitAgentRequest({
    episodeId: EP,
    shotId: "s01",
    stageId: "characters",
    message: "Unbutton the top button of the shirt.",
    character,
    prompt: "",
    refsNote: "",
    workflowNote: "",
    provider,
  });
}

test("выбранный персонаж записывается в запрос и попадает в задачу в llm_task.md", () => {
  const request = submit("manual", "MAN_PTU");
  assert.equal(request.character, "man_ptu");
  assert.equal(readAgentRequest(EP, "s01", "characters")?.character, "man_ptu");
  const task = readLlmTask(EP, "s01", "characters");
  assert.match(task, /Пользователь выбрал на странице персонажа man_ptu/);
  assert.match(task, /## man_ptu/);
});

test("персонаж не из кадра игнорируется, запрос не ломается", () => {
  // этап занят прошлым запросом
  fs.rmSync(path.join(shotDir(EP, "s01"), "characters", "agent_request.json"), { force: true });
  fs.rmSync(path.join(shotDir(EP, "s01"), "characters", "stage_state.json"), { force: true });
  const request = submit("manual", "somebody_else");
  assert.equal(request.character, undefined);
  assert.doesNotMatch(readLlmTask(EP, "s01", "characters"), /выбрал на странице персонажа/);
});

test("текстовый режим доски получает ту же строку про выбранного персонажа", async () => {
  fs.rmSync(path.join(shotDir(EP, "s01"), "characters", "agent_request.json"), { force: true });
  fs.rmSync(path.join(shotDir(EP, "s01"), "characters", "stage_state.json"), { force: true });
  const calls: AgentTask[] = [];
  overrideAgentProvider("claude", {
    id: "claude",
    label: "Claude (fake)",
    modes: ["text", "agent"],
    async check() {
      return { available: true };
    },
    async run(task) {
      calls.push(task);
      return { status: "done", prompt: "## man_ptu\nUnbutton the top button of the shirt in image 1.\n" };
    },
  });
  const request = submit("claude", "man_ptu");
  await agentRunPromise(EP, request.id);
  assert.equal(calls.length, 1);
  assert.match(calls[0].user, /selected character: man_ptu/);
  assert.match(calls[0].user, /leave the sections of the other characters empty/);
  overrideAgentProvider("claude", null);
});
