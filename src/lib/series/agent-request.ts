import crypto from "crypto";
import fs from "fs";
import path from "path";
import { STAGES, type StageId } from "./constants";
import { writeText } from "./media";
import { updateStageDocs } from "./mutations";
import { agentInboxRelative, assertSafeSegment, getSeriesRoot, stageDir } from "./paths";

const TOUCH_FILE = "agent_touch.json";
const BASELINE_FILE = "agent_baseline.json";
const REQUEST_JSON = "agent_request.json";
const REQUEST_MD = "agent_request.md";

export interface RefFingerprint {
  name: string;
  sha256: string;
  bytes: number;
}

export interface AgentBaseline {
  capturedAt: string;
  prompt: string;
  refsNote: string;
  workflowNote: string;
  refs: RefFingerprint[];
}

export interface AgentRequestFile {
  id: string;
  shotId: string;
  stageId: StageId;
  createdAt: string;
  status: "pending" | "done";
  message: string;
  refsChangedByUser: boolean;
  changes: {
    prompt: "changed" | "unchanged" | "no-baseline";
    refsNote: "changed" | "unchanged" | "no-baseline";
    workflowNote: "changed" | "unchanged" | "no-baseline";
    refFilesAdded: string[];
    refFilesRemoved: string[];
    refFilesReplaced: string[];
  };
  current: {
    prompt: string;
    refsNote: string;
    workflowNote: string;
    refFiles: RefFingerprint[];
  };
}

export interface AgentRequestSummary {
  status: "pending" | "done";
  createdAt: string;
  refsChangedByUser: boolean;
}

function touchPath(shotId: string, stageId: StageId): string {
  return path.join(stageDir(shotId, stageId), TOUCH_FILE);
}

function readTouch(shotId: string, stageId: StageId): boolean {
  const file = touchPath(shotId, stageId);
  if (!fs.existsSync(file)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as { refsTouchedByUser?: boolean };
    return data.refsTouchedByUser === true;
  } catch {
    return false;
  }
}

function readBaseline(shotId: string, stageId: StageId): AgentBaseline | null {
  const file = path.join(stageDir(shotId, stageId), BASELINE_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as AgentBaseline;
  } catch {
    return null;
  }
}

function fingerprintRefs(shotId: string, stageId: StageId): RefFingerprint[] {
  const dir = path.join(stageDir(shotId, stageId), "refs");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => fs.statSync(path.join(dir, name)).isFile())
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const bytes = fs.readFileSync(path.join(dir, name));
      return {
        name,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      };
    });
}

function textChange(
  baseline: AgentBaseline | null,
  key: "prompt" | "refsNote" | "workflowNote",
  current: string,
): "changed" | "unchanged" | "no-baseline" {
  if (!baseline) return "no-baseline";
  return baseline[key] === current ? "unchanged" : "changed";
}

function listNames(items: string[]): string {
  return items.length ? items.join(", ") : "(none)";
}

function renderRequestMarkdown(request: AgentRequestFile): string {
  const refsRule = request.refsChangedByUser
    ? "refsChangedByUser is true. Leave every file in refs/ as it is. Rewrite prompt.md only."
    : "refsChangedByUser is false. Rewrite prompt.md. Rebuild reference images only if the user message means the current references are wrong.";

  return `# Agent request

The user sent this from «Рекомендация для LLM».

- shot: ${request.shotId}
- stage: ${request.stageId}
- at: ${request.createdAt}
- status: ${request.status}
- refsChangedByUser: ${request.refsChangedByUser}

## User message

${request.message.trim()}

## Changes

- prompt: ${request.changes.prompt}
- refs.md: ${request.changes.refsNote}
- workflow.md: ${request.changes.workflowNote}
- ref files added: ${listNames(request.changes.refFilesAdded)}
- ref files removed: ${listNames(request.changes.refFilesRemoved)}
- ref files replaced: ${listNames(request.changes.refFilesReplaced)}

## Current prompt.md

${request.current.prompt.trim() || "(empty)"}

## Current refs.md

${request.current.refsNote.trim() || "(empty)"}

## Current workflow.md

${request.current.workflowNote.trim() || "(empty)"}

## Current files in refs/

${
  request.current.refFiles.length
    ? request.current.refFiles.map((file) => `- ${file.name} ${file.sha256}`).join("\n")
    : "(none)"
}

## What to do

${refsRule}

When the pass is done:

1. Write \`${BASELINE_FILE}\` with \`capturedAt\`, \`prompt\`, \`refsNote\`, \`workflowNote\`, and \`refs\` (\`name\`, \`sha256\`, \`bytes\` for each file in \`refs/\`).
2. Write \`${TOUCH_FILE}\` as \`{ "refsTouchedByUser": false }\`.
3. Set \`"status": "done"\` in \`${REQUEST_JSON}\`.
`;
}

function readPendingFormatRequest(
  root: string,
): { episodeId: string; createdAt: string } | null {
  const file = path.join(root, "format_request.json");
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
      status?: string;
      episodeId?: string;
      createdAt?: string;
    };
    if (data.status !== "pending" || !data.episodeId) return null;
    return { episodeId: data.episodeId, createdAt: data.createdAt || "" };
  } catch {
    return null;
  }
}

function listShotIds(root: string): string[] {
  const dir = path.join(root, "shots");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^s\d+$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function readAgentRequest(shotId: string, stageId: StageId): AgentRequestFile | null {
  const file = path.join(stageDir(shotId, stageId), REQUEST_JSON);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as AgentRequestFile;
  } catch {
    return null;
  }
}

export function readAgentRequestSummary(
  shotId: string,
  stageId: StageId,
): AgentRequestSummary | null {
  const request = readAgentRequest(shotId, stageId);
  if (!request) return null;
  return {
    status: request.status,
    createdAt: request.createdAt,
    refsChangedByUser: request.refsChangedByUser,
  };
}

export function rebuildAgentInbox(): void {
  const root = getSeriesRoot();
  const lines = [
    "# Входящие агенту",
    "",
    "Разбирай запросы со статусом `pending`. Если в json уже `done`, пропусти. Что сделать — в самом файле запроса.",
    "",
  ];
  let pending = 0;

  const formatRequest = readPendingFormatRequest(root);
  if (formatRequest) {
    pending += 1;
    lines.push("## format-scenario");
    lines.push(`- эпизод: ${formatRequest.episodeId}`);
    lines.push(`- время: ${formatRequest.createdAt}`);
    lines.push("- сырой текст: scenario_raw.md");
    lines.push("- записать разметку в: scenario.md");
    lines.push("- папки shots не создавать");
    lines.push("- задание: format_request.md");
    lines.push("");
  }

  for (const shotId of listShotIds(root)) {
    for (const stageId of STAGES) {
      const request = readAgentRequest(shotId, stageId);
      if (!request || request.status !== "pending") continue;
      pending += 1;
      const preview = request.message.trim().split(/\r?\n/)[0] || "(пусто)";
      lines.push(`## ${shotId} · ${stageId}`);
      lines.push(`- время: ${request.createdAt}`);
      lines.push(
        `- референсы менял пользователь: ${request.refsChangedByUser ? "да" : "нет"}`,
      );
      lines.push(`- сообщение: ${preview}`);
      lines.push(`- файл: shots/${shotId}/${stageId}/${REQUEST_MD}`);
      lines.push("");
    }
  }

  if (!pending) {
    lines.push("Пусто.");
    lines.push("");
  }

  if (pending) {
    lines.push(`Файл входящих: ${agentInboxRelative(formatRequest?.episodeId)}.`);
    lines.push("");
  }

  writeText(path.join(root, "agent_inbox.md"), lines.join("\n"));
}

export function submitAgentRequest(options: {
  shotId: string;
  stageId: StageId;
  message: string;
  prompt: string;
  refsNote: string;
  workflowNote: string;
}): AgentRequestFile {
  const shotId = assertSafeSegment(options.shotId, "shot");
  const message = options.message.trim();
  if (!message) {
    throw new Error("Сначала напиши, что переделать");
  }

  const baseline = readBaseline(shotId, options.stageId);
  const touched = readTouch(shotId, options.stageId);
  const currentRefs = fingerprintRefs(shotId, options.stageId);

  updateStageDocs({
    shotId,
    stageId: options.stageId,
    prompt: options.prompt,
    llmNotes: options.message,
    refs: options.refsNote,
    workflow: options.workflowNote,
  });

  const baseRefs = new Map((baseline?.refs ?? []).map((file) => [file.name, file.sha256]));
  const currentMap = new Map(currentRefs.map((file) => [file.name, file.sha256]));
  const refFilesAdded = currentRefs.filter((file) => !baseRefs.has(file.name)).map((file) => file.name);
  const refFilesRemoved = [...baseRefs.keys()].filter((name) => !currentMap.has(name));
  const refFilesReplaced = currentRefs
    .filter((file) => baseRefs.has(file.name) && baseRefs.get(file.name) !== file.sha256)
    .map((file) => file.name);
  const refsDifferFromBaseline = baseline
    ? refFilesAdded.length > 0 || refFilesRemoved.length > 0 || refFilesReplaced.length > 0
    : false;
  const refsChangedByUser = touched || refsDifferFromBaseline;

  const request: AgentRequestFile = {
    id: `${shotId}-${options.stageId}-${Date.now()}`,
    shotId,
    stageId: options.stageId,
    createdAt: new Date().toISOString(),
    status: "pending",
    message,
    refsChangedByUser,
    changes: {
      prompt: textChange(baseline, "prompt", options.prompt),
      refsNote: textChange(baseline, "refsNote", options.refsNote),
      workflowNote: textChange(baseline, "workflowNote", options.workflowNote),
      refFilesAdded: baseline ? refFilesAdded : [],
      refFilesRemoved: baseline ? refFilesRemoved : [],
      refFilesReplaced: baseline ? refFilesReplaced : [],
    },
    current: {
      prompt: options.prompt,
      refsNote: options.refsNote,
      workflowNote: options.workflowNote,
      refFiles: currentRefs,
    },
  };

  const dir = stageDir(shotId, options.stageId);
  writeText(path.join(dir, REQUEST_JSON), JSON.stringify(request, null, 2) + "\n");
  writeText(path.join(dir, REQUEST_MD), renderRequestMarkdown(request));
  rebuildAgentInbox();
  return request;
}
