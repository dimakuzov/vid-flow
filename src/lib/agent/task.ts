import fs from "fs";
import path from "path";
import type { AgentMode, AgentRequestFile, AgentTask } from "../contracts/agent-request";
import type { ImageInput, WorkflowChoice } from "../contracts/graph-binding";
import { resolveImageInput, slotFile, stageBindings, stageDuration } from "../comfy/binding";
import { listWorkflowChoices, resolveWorkflowId } from "../comfy/workflows";
import type { StageId } from "../series/constants";
import { readTextIfExists } from "../series/media";
import { getPlaybooksRoot, stageDir } from "../series/paths";
import { excludedFiles, readRunSettings } from "../series/run-settings";
import { readShotSpeech, stageHasSpeech } from "../series/speech";
import { readShotMeta } from "../series/shot-meta";
import { LLM_TASK, readAgentDispatch } from "./files";
import { renderShotContext } from "./shot-context";

/*
 * Сборка AgentTask для провайдера (docs/contracts/agent-request.md, режим text).
 * system — правило ответа и плейбук модели выбранного воркфлоу; user — всё про кадр.
 */

const TEXT_RULES = `You write prompt.md for one stage of a video shot.
prompt.md is sent to the generation model exactly as written.
Reply with the complete new text of prompt.md and nothing else: no preface, no explanation, no Markdown code fences, no quotes around it.
Follow the playbook below for language, structure and length. Keep what the user did not ask to change.`;

/** Последние три этапа: в модель уходит картинка или видео, и промпт читает она, а не человек. */
const GENERATION_STAGES = new Set<StageId>(["first_frame", "video_preview", "final_render"]);

/**
 * Общие правила prompt.md этих этапов. Стоят над плейбуком модели: иначе каждый воркфлоу
 * заново учит агента писать имена людей и «как в прошлый раз».
 */
export const GENERATION_PROMPT_RULES = `These rules override the playbook wherever it disagrees. They apply to every workflow of this stage.

prompt.md is English. No Cyrillic anywhere in it. Do not translate any of it into Russian, including the spoken lines: write a line in English even when speech.md has it in Russian.

Before every new agent run, check the lines again. The Lines section in this task is speech.md as of this request, and it can change between requests. Do not keep the lines already written in prompt.md when they differ from that section: replace them, even if the user asked for something else. An English line is copied word for word. A line in Cyrillic is written in English. No Lines section means nobody speaks: remove any spoken line from the prompt.

People in prompt.md are character1, character2, character3, in the order of their reference images (the same order as «Images the graph receives»; if that list is absent, alphabetical order of the names in the characters line, so the same person keeps the same number on every stage). Names in the user message, in shot.md and in file names are only so you know whom the user means. Do not write those names in prompt.md. An example in the playbook that says Julia, Lena or any other name is the old form: write character1 and character2.

Describe each person in one or two sentences, enough to tell them apart, with no production name. If that person has reference images, bind them in those sentences: \`character1 is image 2 and the face from image 4\`. Use the numbers from the image list. Where the playbook says @img-N, use that label the same way.

prompt.md is the whole instruction for this one run. The model has not seen the previous result, so never compare this picture with it. Forbidden, even if the current prompt.md already says it: "than before", "as before", "like before", "last time", "much closer", "even closer", "closer than". When the user says "ещё ближе" or "much closer", rewrite the size sentences to say how close the person is now: \`very close: her face and shoulders fill most of the frame\`. Do not add "than before". When the user asks for one change, write the previous prompt out again in full with that change included, and drop any comparison with the previous result. "All good, put a bag in Ivan's hands" becomes the previous prompt plus the bag in the hands of whichever character Ivan is. "exactly as in image N" is about a reference picture, and that stays.`;

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

/** Кто на картинке входа. Имя — только для задачи агенту; в prompt.md его заменяет characterN. */
function personOnImage(
  input: ImageInput,
  file: string,
  shotId: string,
): { role: "location" | "figure" | "face" | "other"; name: string } {
  const sources = Array.isArray(input.from) ? input.from : [input.from];
  const stem = path.parse(file).name;
  if (sources.includes("library:faces")) {
    const name = /_face$/i.test(stem) ? stem.slice(0, -"_face".length) : path.basename(path.dirname(file));
    return { role: "face", name: name.toLowerCase() };
  }
  if (sources.includes("approve:characters")) {
    const suffix = `_${shotId}`;
    const name = stem.toLowerCase().endsWith(suffix.toLowerCase()) ? stem.slice(0, -suffix.length) : stem;
    return { role: "figure", name: name.toLowerCase() };
  }
  if (sources.some((source) => source.endsWith(":location") || source === "approve:location")) {
    return { role: "location", name: "" };
  }
  return { role: "other", name: "" };
}

/**
 * Номера картинок, которые получит граф первого кадра: `image N` в prompt.md. Номер — порядок
 * слотов-картинок манифеста, которым достался файл (тот же slotFile, что и при запуске): ряд
 * `image_2`…`image_6` заполняется подряд, без пропусков. Что не влезло в граф — отдельной строкой.
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
  const images: Record<string, string[]> = {};
  for (const [name, input] of Object.entries(binding.inputs)) {
    if (input.kind === "image" || input.kind === "video") images[name] = resolveImageInput(ctx, input);
  }
  const lines: string[] = [];
  const sent = new Set<string>();
  const characterOf = new Map<string, number>();
  const characterFor = (name: string) => {
    const key = name.toLowerCase();
    const existing = characterOf.get(key);
    if (existing) return existing;
    const next = characterOf.size + 1;
    characterOf.set(key, next);
    return next;
  };
  for (const slot of binding.slots) {
    const found = slotFile(binding, slot, images);
    if (!found) continue;
    sent.add(`${found.name}:${found.index}`);
    const who = personOnImage(found.input, found.file, shotId);
    const fileName = path.basename(found.file);
    const number = lines.length + 1;
    if (who.role === "location") {
      lines.push(`- image ${number}: the location (${fileName})`);
    } else if (who.role === "figure" || who.role === "face") {
      const kind = who.role === "face" ? "face" : "approved figure and clothes";
      lines.push(
        `- image ${number}: character${characterFor(who.name)} ${kind} (${who.name} in the task; do not write that name) (${fileName})`,
      );
    } else {
      lines.push(`- image ${number}: ${found.input.label} (${fileName})`);
    }
  }
  if (!lines.length) return "";
  const left = Object.entries(images).flatMap(([name, files]) =>
    files.filter((_, index) => !sent.has(`${name}:${index}`)).map((file) => path.basename(file)),
  );
  const parts = [
    "## Images the graph receives (use these numbers in prompt.md)",
    "",
    ...lines,
    "",
    "Every image above goes to the model. In prompt.md call the people character1, character2, … in this order. One or two sentences each, and bind the references by these numbers: `character1 is image 2 and the face from image 4`. Do not write the name from the task or the file.",
  ];
  if (left.length) {
    parts.push("", `Not sent, the graph takes at most ${lines.length} images: ${left.join(", ")}. Do not refer to them.`);
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
  const rules = GENERATION_STAGES.has(stageId) ? `\n\n${GENERATION_PROMPT_RULES}` : "";
  const system = playbook
    ? `${TEXT_RULES}${rules}\n\n# Playbook (${playbook.file})\n\n${playbook.text.trim()}\n`
    : `${TEXT_RULES}${rules}\n`;

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
    `## Shot ${shotId}: ${meta.title} (original scenario text from shot.md, written before the pictures)`,
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
  ];
  const context = renderShotContext(episodeId, shotId, stageId, request.createdAt);
  if (context) lines.push("", context);
  lines.push(
    "",
    "## Current prompt.md",
    "",
    prompt || "(empty)",
    "",
    "## Files in refs/",
    "",
    refs.length ? refs.map((name) => `- ${name}`).join("\n") : "(none)",
  );
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
      "## Lines (speech.md, read again for this request; they may have changed since the last prompt)",
      "",
      "An English line goes into prompt.md word for word. A line in Cyrillic is written in English: do not copy the Cyrillic and do not translate the line into Russian. The speaker is character1, character2, not the name before the colon. If these lines differ from the ones in the current prompt.md, replace them.",
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
