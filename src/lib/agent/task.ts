import fs from "fs";
import path from "path";
import type { AgentMode, AgentRequestFile, AgentTask } from "../contracts/agent-request";
import type { WorkflowChoice } from "../contracts/graph-binding";
import { listWorkflowChoices, resolveWorkflowId } from "../comfy/workflows";
import type { StageId } from "../series/constants";
import { readTextIfExists } from "../series/media";
import { getPlaybooksRoot, stageDir } from "../series/paths";
import { readRunSettings } from "../series/run-settings";
import { readShotMeta } from "../series/shot-meta";
import { LLM_TASK, readAgentDispatch } from "./files";

/*
 * Сборка AgentTask для провайдера (docs/contracts/agent-request.md, режим text).
 * system — правило ответа и плейбук модели выбранного воркфлоу; user — всё про кадр.
 */

const TEXT_RULES = `You write prompt.md for one stage of a video shot.
prompt.md is sent to the generation model exactly as written.
Reply with the complete new text of prompt.md and nothing else: no preface, no explanation, no Markdown code fences, no quotes around it.
Follow the playbook below for language, structure and length. Keep what the user did not ask to change.`;

/** Вариант, с которым доска поставит прогон после ответа агента. null — у этапа нет воркфлоу. */
export function selectedWorkflow(episodeId: string, shotId: string, stageId: StageId): WorkflowChoice | null {
  const choices = listWorkflowChoices(episodeId, shotId, stageId);
  if (!choices.length) return null;
  const dispatch = readAgentDispatch(episodeId, shotId, stageId);
  const requested =
    dispatch?.workflow || dispatch?.videoWorkflow || readRunSettings(episodeId, shotId, stageId).workflow;
  let id: string | null = null;
  try {
    id = resolveWorkflowId(episodeId, shotId, stageId, requested);
  } catch {
    id = resolveWorkflowId(episodeId, shotId, stageId, null);
  }
  return choices.find((choice) => choice.id === id) ?? choices.find((choice) => choice.isDefault) ?? null;
}

/** Плейбук для модели: поле playbook манифеста (сначала .en.md), иначе stages/<stage>.en.md. */
export function resolvePlaybook(stageId: StageId, playbook: string | null | undefined): { file: string; text: string } | null {
  const candidates: string[] = [];
  if (playbook) {
    if (!playbook.endsWith(".en.md")) candidates.push(playbook.replace(/\.md$/, ".en.md"));
    candidates.push(playbook);
  }
  candidates.push(`stages/${stageId}.en.md`, `stages/${stageId}.md`);
  const root = getPlaybooksRoot();
  for (const relative of candidates) {
    const file = path.join(root, relative);
    if (fs.existsSync(file)) return { file: `playbooks/${relative}`, text: fs.readFileSync(file, "utf8") };
  }
  return null;
}

function listFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => fs.statSync(path.join(dir, name)).isFile())
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function buildTextParts(request: AgentRequestFile): { system: string; user: string } {
  const { episodeId, shotId, stageId } = request;
  const dir = stageDir(episodeId, shotId, stageId);
  const workflow = selectedWorkflow(episodeId, shotId, stageId);
  const playbook = resolvePlaybook(stageId, workflow?.playbook);
  const system = playbook
    ? `${TEXT_RULES}\n\n# Playbook (${playbook.file})\n\n${playbook.text.trim()}\n`
    : `${TEXT_RULES}\n`;

  const meta = readShotMeta(episodeId, shotId);
  const prompt = readTextIfExists(path.join(dir, "prompt.md")).trim();
  const refsNote = readTextIfExists(path.join(dir, "refs.md")).trim();
  const refs = listFiles(path.join(dir, "refs"));
  const lines = [
    "## User request",
    "",
    request.message.trim(),
    "",
    `## Shot ${shotId}: ${meta.title}`,
    "",
    meta.summary || "(no action text in shot.md)",
    "",
    `- characters: ${meta.characters.join(", ") || "(none)"}`,
    `- location: ${meta.location || "(none)"}`,
    `- stage: ${stageId}`,
    `- workflow: ${workflow ? `${workflow.id} — ${workflow.label}` : "(none)"}`,
    "",
    "## Current prompt.md",
    "",
    prompt || "(empty)",
    "",
    "## Files in refs/",
    "",
    refs.length ? refs.map((name) => `- ${name}`).join("\n") : "(none)",
  ];
  if (refsNote) lines.push("", "## refs.md", "", refsNote);
  lines.push("", "Write the new prompt.md.");
  return { system, user: lines.join("\n") + "\n" };
}

export function buildAgentTask(request: AgentRequestFile, mode: AgentMode, timeoutMs: number): AgentTask {
  const dir = stageDir(request.episodeId, request.shotId, request.stageId);
  const parts = mode === "text" ? buildTextParts(request) : { system: "", user: "" };
  return {
    request,
    mode,
    stageDir: dir,
    projectRoot: process.cwd(),
    taskMarkdown: readTextIfExists(path.join(dir, LLM_TASK)),
    system: parts.system,
    user: parts.user,
    timeoutMs,
  };
}
