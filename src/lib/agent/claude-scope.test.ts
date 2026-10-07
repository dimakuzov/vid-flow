// Вызов claude -p: агент этапа видит только свой кадр и этап, без настроек, MCP и CLAUDE.md проекта.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-claude-scope-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import type { AgentRequestFile, AgentTask } from "../contracts/agent-request";
import { getCharactersRoot, getComfyQueueRoot, getLocationsRoot, getPlaybooksRoot, shotDir, stageDir } from "../series/paths";
import { claudeInvocation, claudeUsage } from "./providers";

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const REPO = path.resolve(__dirname, "../../..");

function task(mode: AgentTask["mode"], stageId: AgentRequestFile["stageId"], system = "Playbook text.") {
  return {
    request: { id: "r1", episodeId: "e01", shotId: "s16", stageId, model: "claude-haiku-4-5-20251001" } as AgentRequestFile,
    mode,
    stageDir: stageDir("e01", "s16", stageId),
    projectRoot: REPO,
    taskMarkdown: "",
    system,
    user: "## User request\n\nВечер.",
    timeoutMs: 1000,
  } satisfies AgentTask;
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

test("текст: без инструментов, MCP и системного промпта Claude Code, вне репозитория", () => {
  const call = claudeInvocation(task("text", "first_frame"));
  assert.equal(flag(call.args, "--tools"), "", "инструменты выключены");
  assert.ok(call.args.includes("--strict-mcp-config"));
  assert.ok(call.args.includes("--no-session-persistence"));
  assert.equal(flag(call.args, "--system-prompt"), "Playbook text.", "системная часть — только плейбук");
  assert.equal(flag(call.args, "--model"), "claude-haiku-4-5-20251001");
  assert.equal(call.stdin, "## User request\n\nВечер.\n");
  assert.ok(!path.resolve(call.cwd).startsWith(REPO), "CLAUDE.md и AGENTS.md проекта не подхватываются");
});

test("текст: длинный плейбук и claude.cmd — всё в stdin", () => {
  const long = claudeInvocation(task("text", "first_frame", "x".repeat(30_000)));
  assert.ok(long.stdin?.startsWith("x".repeat(100)));
  const viaCmd = claudeInvocation(task("text", "first_frame", 'Say "hi".\nLine two.'), true);
  assert.ok(!flag(viaCmd.args, "--system-prompt")?.includes('"'));
  assert.ok(viaCmd.stdin?.includes('Say "hi".'));
});

test("расход из ответа claude: токены, стоимость, время модели; время процесса — по часам доски", () => {
  const usage = claudeUsage(
    {
      usage: { input_tokens: 10, cache_creation_input_tokens: 5000, cache_read_input_tokens: 0, output_tokens: 120 },
      total_cost_usd: 0.012,
      duration_api_ms: 3100,
      num_turns: 1,
    },
    48_765.4,
  );
  assert.deepEqual(usage, {
    durationMs: 48_765,
    inputTokens: 10,
    cacheWriteTokens: 5000,
    cacheReadTokens: 0,
    outputTokens: 120,
    costUsd: 0.012,
    apiDurationMs: 3100,
    turns: 1,
  });
  assert.deepEqual(claudeUsage(null, 2000), { durationMs: 2000 }, "не JSON — только время");
});

test("агент: только папки кадра и этапа, рамки одного этапа, без настроек и MCP", () => {
  const call = claudeInvocation(task("agent", "characters"));
  assert.ok(call.args.includes("--restricted"), "без настроек, файлы только в --add-dir");
  assert.ok(call.args.includes("--strict-mcp-config"));
  assert.equal(flag(call.args, "--tools"), "Read,Write,Edit,Glob,Grep,Bash");
  const dirs = call.args.slice(call.args.indexOf("--add-dir") + 1);
  assert.deepEqual(dirs, [
    shotDir("e01", "s16"),
    getPlaybooksRoot(),
    getComfyQueueRoot(),
    path.join(REPO, "docs", "contracts"),
    getCharactersRoot(),
  ]);
  assert.ok(!dirs.includes(REPO), "корень проекта агенту не открыт");
  const rules = flag(call.args, "--append-system-prompt") ?? "";
  assert.match(rules, /ONE stage of ONE shot: episode e01, shot s16, stage characters/);
  assert.match(rules, /Do not open other shots/);
  assert.match(rules, /Do not start, prepare or plan any other stage/);
  assert.ok(!path.resolve(call.cwd).startsWith(REPO));

  const location = claudeInvocation(task("agent", "location"));
  assert.ok(location.args.includes(getLocationsRoot()));
  assert.ok(!location.args.includes(getCharactersRoot()), "библиотека персонажей локации не нужна");
});
