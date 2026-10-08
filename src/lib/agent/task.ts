import fs from "fs";
import path from "path";
import type { AgentMode, AgentRequestFile, AgentTask } from "../contracts/agent-request";
import type { ImageInput, WorkflowChoice } from "../contracts/graph-binding";
import { resolveImageInput, stageBindings, stageDuration } from "../comfy/binding";
import { listWorkflowChoices, resolveWorkflowId } from "../comfy/workflows";
import type { StageId } from "../series/constants";
import { readTextIfExists } from "../series/media";
import { getPlaybooksRoot, stageDir } from "../series/paths";
import { excludedFiles, readRunSettings } from "../series/run-settings";
import { readShotSpeech, stageHasSpeech } from "../series/speech";
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

/** Кто на картинке входа: имя персонажа из `julia_s05.png`, лицо — по папке библиотеки или `{name}_face`. */
function imageSubject(input: ImageInput, file: string, shotId: string): string {
  const sources = Array.isArray(input.from) ? input.from : [input.from];
  const stem = path.parse(file).name;
  if (sources.includes("library:faces")) {
    const name = /_face$/i.test(stem) ? stem.slice(0, -"_face".length) : path.basename(path.dirname(file));
    return `${name.toLowerCase()}'s face`;
  }
  if (sources.includes("approve:characters")) {
    const suffix = `_${shotId}`;
    return stem.toLowerCase().endsWith(suffix.toLowerCase()) ? stem.slice(0, -suffix.length) : stem;
  }
  if (sources.some((source) => source.endsWith(":location") || source === "approve:location")) return "the location";
  return input.label;
}

/**
 * Номера картинок, которые получит граф первого кадра: `image N` в prompt.md. Нода Qwen берёт
 * подключённые картинки по порядку и сжимает пропуски, поэтому номера идут подряд.
 * Входы с whenPrompt (лица) — отдельным списком: граф получит их, только если промпт их зовёт.
 */
export function renderGraphImages(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  workflowId: string | null | undefined,
): string {
  if (stageId !== "first_frame" || !workflowId) return "";
  const binding = stageBindings(stageId).find((item) => item.id === workflowId)?.binding;
  if (!binding) return "";
  const ctx = { episodeId, shotId, stageId };
  const always: string[] = [];
  const optional: { line: string; when: string }[] = [];
  let number = 0;
  for (const input of Object.values(binding.inputs)) {
    if (input.kind !== "image" && input.kind !== "video") continue;
    for (const file of resolveImageInput(ctx, { ...input, whenPrompt: undefined })) {
      number += 1;
      const line = `- image ${number}: ${imageSubject(input, file, shotId)} (${path.basename(file)})`;
      if (input.whenPrompt) optional.push({ line, when: input.whenPrompt });
      else always.push(line);
    }
  }
  if (!always.length) return "";
  const parts = [
    "## Images the graph receives (use these numbers in prompt.md)",
    "",
    ...always,
  ];
  if (optional.length) {
    parts.push(
      "",
      "Face references, only for a close-up (playbook section «Face for a close-up»). The board attaches them only if prompt.md contains the phrase `face from image N`; without that phrase they are not sent and the numbers above stay as they are:",
      "",
      ...optional.map((item) => item.line),
    );
  }
  parts.push("", "Never write file names or paths in prompt.md: the model sees only the image numbers.");
  return parts.join("\n");
}

/** Длительность, выбранная в меню этапа для воркфлоу. null — «по умолчанию» или у воркфлоу нет меню. */
export function chosenDurationSec(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  workflowId: string | null | undefined,
): number | null {
  return stageDuration({ episodeId, shotId, stageId }, workflowId ?? null).durationSec;
}

/** Строка для llm_task.md: длительность выбрана в меню, `N sec` в prompt.md не нужен. */
export function durationTaskLine(seconds: number): string {
  return `Длительность клипа: ${seconds} с. Действие должно уложиться в это время.`;
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
  const seconds = chosenDurationSec(episodeId, shotId, stageId, workflow?.id);
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
    ...(seconds != null
      ? [
          `- clip duration: ${seconds} s, chosen by the user in the board menu. The action must fit into this time. The board sets the duration itself: do not write "N sec" in prompt.md.`,
        ]
      : []),
    "",
    "## Current prompt.md",
    "",
    prompt || "(empty)",
    "",
    "## Files in refs/",
    "",
    refs.length ? refs.map((name) => `- ${name}`).join("\n") : "(none)",
  ];
  if (stageHasSpeech(stageId)) {
    // Кто где стоит в кадре — из промпта первого кадра: нужно для реплик «Person 1 (left) says».
    const firstFrame = readTextIfExists(path.join(stageDir(episodeId, shotId, "first_frame"), "prompt.md")).trim();
    if (firstFrame) {
      lines.push(
        "",
        "## First frame prompt.md (who is where in the frame; for reference only, not to copy)",
        "",
        firstFrame,
      );
    }
  }
  if (stageHasSpeech(stageId)) {
    const speech = readShotSpeech(episodeId, shotId).trim();
    lines.push(
      "",
      "## Lines (speech.md: what the characters say aloud, word for word)",
      "",
      speech || "(none: nobody speaks in this shot)",
    );
  }
  const images = renderGraphImages(episodeId, shotId, stageId, workflow?.id);
  if (images) lines.push("", images);
  const excluded = [...excludedFiles(episodeId, shotId, stageId)];
  if (excluded.length) {
    lines.push(
      "",
      "## Removed from the graph by the user",
      "",
      "These files stay on disk but the graph does not get them. Do not refer to them and do not count them in the image numbers:",
      "",
      ...excluded.map((item) => `- data/${item}`),
    );
  }
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
