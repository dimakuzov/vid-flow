import fs from "fs";
import path from "path";
import type { AgentMode, AgentRequestFile, AgentTask } from "../contracts/agent-request";
import type { ImageInput, WorkflowChoice } from "../contracts/graph-binding";
import {
  approvedMetaTexts,
  FACE_SHEET,
  mediaDurationSec,
  resolveImageInput,
  slotFile,
  stageBindings,
  stageDuration,
} from "../comfy/binding";
import { listWorkflowChoices, resolveWorkflowId } from "../comfy/workflows";
import type { StageId } from "../series/constants";
import { readTextIfExists } from "../series/media";
import { getPlaybooksRoot, stageDir } from "../series/paths";
import { excludedFiles, readRunSettings } from "../series/run-settings";
import { readShotSpeech, stageHasSpeech } from "../series/speech";
import { readShotMeta } from "../series/shot-meta";
import { LLM_TASK, readAgentDispatch, readBaseline } from "./files";
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

Bind each person to their images once, in the first lines of prompt.md, with a few words that tell the people apart as the reference shows them (build, hair, the most visible garment): \`character1 is image 2 and the face from image 4: a tall slim young man in an off-white jacket.\` Use the numbers from the image list. When the image list and the playbook name people <Subject N> and pictures <Picture N> (MiniMax H3), use those labels instead: <Subject 1> is character1, and the binding goes into subject_definitions: \`<Subject 1> is the young woman defined by <Picture 2>\`.

prompt.md is the whole instruction for this one run, and the model has not seen any earlier result. Write every sentence as the picture should be now: how close the person is, where they sit, what they hold. A comparison with an earlier result ("than before", "as before", "closer than", "last time", "the same as last time") gives the model nothing to work with; when the current prompt.md has one, write the state it means instead: "much closer than before" becomes "very close: her face and shoulders fill most of the frame".

When the current prompt.md is written in another workflow's form (its opening, its labels, its sections differ from this playbook), rewrite all of it in this playbook's form: keep its content (the action, its order and timing, the spoken lines, the user's corrections) and leave its old form behind.

When the user asks for one change, rebuild prompt.md from the playbook template: keep the lines that still serve the shot and the user's notes, put the change into the line it belongs to, and leave out lines that no longer serve. Every idea appears once. Before writing, find every sentence of the current prompt.md that says the opposite of the new note or keeps the old state (\`does not rise\` when the note asks her to stand up; a walking line when the note says she stays) and take it out. The final prompt.md says each person's state once, as the note wants it. "All good, put a bag in Ivan's hands" becomes the current prompt with the bag in the action line of whichever character Ivan is. "exactly as in image N" is about a reference picture, and that stays.`;

/**
 * Локация — пустое место. Текст кадра часто описывает, кто там потом встанет
 * («вид из-за её плеча»), и модель переносит человека в prompt.md как ракурс.
 * Правило стоит после плейбука и отменяет и его, и текст кадра.
 */
export const LOCATION_EMPTY_RULES = `These rules override the playbook and the shot text.

This stage draws an empty place. Do not write a person into prompt.md unless the user message explicitly asks for a person in the location.

The shot text may say who will stand there later: a close-up of someone, a view from behind her shoulder, two people talking. Take from it only the camera height and which part of the place stays empty. Write that part as the place. "A close-up of Lena from behind her shoulder" becomes "a close-up of the empty place", never "framing from behind a woman's shoulder" and never "the shoulder out of frame".

When the user says to remove a person, or not to add people, delete every mention of a person, a body, a face, a shoulder, a silhouette or a figure from the previous prompt. Do not keep it by moving the body out of frame or by calling it framing. A phrase the user quoted must not appear again and must not be reworded into another mention of that person.`;

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
): { role: "location" | "first" | "figure" | "face" | "sheet" | "reference" | "other"; name: string } {
  const sources = Array.isArray(input.from) ? input.from : [input.from];
  const stem = path.parse(file).name;
  if (sources.some((source) => source === "refs:other" || source.startsWith("refs:other:"))) {
    return { role: "reference", name: "" };
  }
  // Лист лица, лицо или сам персонаж: утверждённый файл лежит в characters/approve, лица — нет.
  if (sources.includes("library:faces-or-characters")) {
    const approved = path.basename(path.dirname(file)) === "approve";
    if (approved) {
      const suffix = `_${shotId}`;
      const name = stem.toLowerCase().endsWith(suffix.toLowerCase()) ? stem.slice(0, -suffix.length) : stem;
      return { role: "figure", name: name.toLowerCase() };
    }
    if (FACE_SHEET.test(stem)) {
      const owner = stem.replace(/[_ -]?face[_ -]?sheet.*$/i, "") || path.basename(path.dirname(file));
      return { role: "sheet", name: owner.toLowerCase() };
    }
    const name = /_face$/i.test(stem) ? stem.slice(0, -"_face".length) : path.basename(path.dirname(file));
    return { role: "face", name: name.toLowerCase() };
  }
  if (sources.includes("approve:first_frame")) return { role: "first", name: "" };
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
 * Номера картинок, которые получит граф: `image N` на первом кадре, а у манифеста с
 * `imageLabel` (MiniMax H3: `<Picture N>`) — на любом этапе. Номер — порядок слотов-картинок
 * манифеста, которым достался файл (тот же slotFile, что и при запуске): ряд заполняется подряд,
 * без пропусков. Что не влезло в граф — отдельной строкой.
 */
export function renderGraphImages(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  workflowId: string | null | undefined,
): string {
  if (!workflowId) return "";
  const binding = stageBindings(stageId).find((item) => item.id === workflowId)?.binding;
  if (!binding || (stageId !== "first_frame" && !binding.imageLabel)) return "";
  // MiniMax зовёт картинки <Picture N>, людей — <Subject N>; Qwen — image N и characterN.
  const label = (n: number) => (binding.imageLabel ? binding.imageLabel.replace("{n}", String(n)) : `image ${n}`);
  const person = (n: number) => (binding.imageLabel ? `<Subject ${n}>` : `character${n}`);
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
      lines.push(`- ${label(number)}: the location (${fileName})`);
    } else if (who.role === "first") {
      lines.push(`- ${label(number)}: the approved first frame: the place, the camera and the people in their clothes (${fileName})`);
    } else if (who.role === "figure" || who.role === "face" || who.role === "sheet") {
      const kind =
        who.role === "sheet"
          ? "face sheet: several views of the same face"
          : who.role === "face"
            ? "face"
            : "approved figure and clothes";
      lines.push(
        `- ${label(number)}: ${person(characterFor(who.name))} ${kind} (${who.name} in the task; do not write that name) (${fileName})`,
      );
    } else if (who.role === "reference" && binding.imageLabel) {
      lines.push(
        `- ${label(number)}: a reference the user gave this shot, not a person: an object, a vehicle or a detail of the place; the user's message and notes say what it is (${fileName})`,
      );
    } else {
      lines.push(`- ${label(number)}: ${found.input.label} (${fileName})`);
    }
  }
  if (!lines.length) return "";
  // Ролик превью у финала — только длительность: в слоты картинок он не идёт и в «не отправлено» не попадает.
  const slotted = new Set(
    binding.slots.flatMap((slot) => {
      const value = slot.value as { input?: string; inputs?: string[] };
      return value.inputs ?? (value.input ? [value.input] : []);
    }),
  );
  const left = Object.entries(images).filter(([name]) => slotted.has(name)).flatMap(([name, files]) =>
    files.filter((_, index) => !sent.has(`${name}:${index}`)).map((file) => path.basename(file)),
  );
  const bind = binding.imageLabel
    ? `Every picture above goes to the model. In prompt.md the people are ${person(1)}, ${person(2)}, … in this order, and the pictures are named exactly as above. Bind each person once, in subject_definitions: \`${person(1)} is the young woman defined by ${label(2)}\`. The name from the task or the file stays out of prompt.md.`
    : "Every image above goes to the model. In prompt.md the people are character1, character2, … in this order. Bind each one once, in the first lines, by these numbers: `character1 is image 2 and the face from image 4`. The name from the task or the file stays out of prompt.md.";
  const parts = [
    `## Images the graph receives (use these ${binding.imageLabel ? "names" : "numbers"} in prompt.md)`,
    "",
    ...lines,
    "",
    bind,
  ];
  if (left.length) {
    parts.push("", `Not sent, the graph takes at most ${lines.length} images: ${left.join(", ")}. Do not refer to them.`);
  }
  parts.push("", `Never write file names or paths in prompt.md: the model sees only the ${binding.imageLabel ? "picture names" : "image numbers"}.`);
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

/**
 * Текущий prompt.md написан агентом под другой воркфлоу этапа (agent_baseline.json): агенту — раздел
 * «перепиши в форме этого плейбука». Иначе пусто. Пользователь мог сменить воркфлоу в меню и
 * нажать «Отправить агенту» без сообщения, или «▶ Все кадры» ведёт цепочку LTX → MiniMax.
 */
export function workflowSwitch(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  workflow: WorkflowChoice | null,
): string {
  const baseline = readBaseline(episodeId, shotId, stageId);
  if (!workflow || !baseline?.workflow || baseline.workflow === workflow.id) return "";
  if (!readTextIfExists(path.join(stageDir(episodeId, shotId, stageId), "prompt.md")).trim()) return "";
  const before = listWorkflowChoices(episodeId, shotId, stageId).find((choice) => choice.id === baseline.workflow);
  return [
    "## The current prompt.md was written for another workflow",
    "",
    `It was written for \`${baseline.workflow}\`${before ? ` (${before.label})` : ""}; this run uses \`${workflow.id}\` (${workflow.label}). Rewrite all of it in the form of the playbook above: its opening, its labels for the pictures and the people, its sections. Keep its content: the action, its order and timing, the spoken lines, and every correction from the user's notes. Phrases that belong to the old form stay behind.`,
  ].join("\n");
}

/** Длина утверждённого превью, которую доска поставит в граф (вход media:duration). null — нет. */
export function previewDurationSec(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  workflowId: string | null | undefined,
): number | null {
  if (!workflowId) return null;
  const binding = stageBindings(stageId).find((item) => item.id === workflowId)?.binding;
  return binding ? mediaDurationSec({ episodeId, shotId, stageId }, binding) : null;
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
  const locationRules = stageId === "location" ? `\n\n${LOCATION_EMPTY_RULES}` : "";
  const system = playbook
    ? `${TEXT_RULES}${rules}\n\n# Playbook (${playbook.file})\n\n${playbook.text.trim()}\n${locationRules}`
    : `${TEXT_RULES}${rules}${locationRules}\n`;

  const meta = readShotMeta(episodeId, shotId);
  const prompt = readTextIfExists(path.join(dir, "prompt.md")).trim();
  const refsNote = readTextIfExists(path.join(dir, "refs.md")).trim();
  const refs = listFiles(path.join(dir, "refs"));
  const seconds = chosenDurationSec(episodeId, shotId, stageId, workflow?.id);
  const previewSeconds = seconds == null ? previewDurationSec(episodeId, shotId, stageId, workflow?.id) : null;
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
    ...(previewSeconds != null
      ? [
          `- clip duration: ${previewSeconds} s, the length of the approved preview; the board sets it. Where the playbook asks for the length of the shot, write this number.`,
        ]
      : []),
  ];
  const context = renderShotContext(episodeId, shotId, stageId, request.createdAt);
  if (context) lines.push("", context);
  const switched = workflowSwitch(episodeId, shotId, stageId, workflow);
  if (switched) lines.push("", switched);
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
      "## Lines (speech.md as of this request; it may have changed since the current prompt.md was written). An English line goes into prompt.md word for word. A line in Cyrillic is written in English: do not copy the Cyrillic and do not translate the line into Russian. The speaker is character1, character2, not the name before the colon. When the spoken lines in the current prompt.md differ from these, use these.",
      "",
      speech || "(none: nobody speaks in this shot; take any spoken line out of the prompt)",
    );
  }
  // Финал без видео-референса: движение эскиза агент переносит в текст сам.
  const metaBinding = workflow ? stageBindings(stageId).find((item) => item.id === workflow.id)?.binding : undefined;
  for (const meta of metaBinding ? approvedMetaTexts({ episodeId, shotId, stageId }, metaBinding) : []) {
    lines.push(
      "",
      `## ${meta.label} (from ${meta.where}: the motion of the approved preview; keep its movements, their order and timing, written in this playbook's form)`,
      "",
      meta.text,
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
