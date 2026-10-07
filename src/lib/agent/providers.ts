import type {
  AgentMode,
  AgentProvider,
  AgentProviderId,
  AgentProviderInfo,
  AgentResult,
  AgentTask,
} from "../contracts/agent-request";
import fs from "fs";
import os from "os";
import path from "path";
import {
  getCharactersRoot,
  getComfyQueueRoot,
  getLocationsRoot,
  getPlaybooksRoot,
  shotDir,
} from "../series/paths";
import { CLAUDE_MODELS, claudeBin, defaultClaudeModel, defaultProviderId, ollamaModel, ollamaUrl } from "./config";
import { resolveExecutable, runProcess } from "./process";

/*
 * Провайдеры агента (docs/contracts/agent-request.md, «Режимы и провайдеры»).
 * check() ничего не запускает и не пишет: только спрашивает Ollama и ищет файл `claude`.
 */

/** Провайдер доски: контракт плюс синхронная проверка настройки (для ответа 400 до записи запроса). */
export interface BoardAgentProvider extends AgentProvider {
  /** Чего не хватает в настройке для этой модели. null — настроен. Сеть не трогает. */
  configError?(model?: string): string | null;
}

const CLAUDE_AGENT_TOOLS = "Read,Write,Edit,Glob,Grep,Bash";

/** Ответ модели → текст prompt.md: без рассуждений <think> и без обрамления ```. */
export function cleanPromptText(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = text.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  if (fenced) text = fenced[1].trim();
  return text;
}

function textPrompt(task: AgentTask): string {
  return `${task.system.trim()}\n\n---\n\n${task.user.trim()}\n`;
}

/** Системная часть длиннее — уходит в stdin вместе с задачей (предел командной строки Windows). */
const SYSTEM_ARG_LIMIT = 20_000;

/**
 * Пустая папка вне репозитория: claude стартует в ней и не подхватывает CLAUDE.md, AGENTS.md,
 * настройки и память проекта. Файлы кадра агенту открывает только --add-dir.
 */
function isolatedCwd(): string {
  const dir = path.join(os.tmpdir(), "frameboard-claude");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Папки, которые видит агент этапа: этот кадр, плейбуки, очередь ComfyUI, контракт задания, библиотека этапа. */
export function agentScopeDirs(task: AgentTask): string[] {
  const { episodeId, shotId, stageId } = task.request;
  const dirs = [
    shotDir(episodeId, shotId),
    getPlaybooksRoot(),
    getComfyQueueRoot(),
    path.join(task.projectRoot, "docs", "contracts"),
  ];
  if (stageId === "characters") dirs.push(getCharactersRoot());
  if (stageId === "location") dirs.push(getLocationsRoot());
  return dirs;
}

/** Рамки агента этапа: один этап одного кадра, больше ничего. */
export function agentScopeRules(task: AgentTask): string {
  const { episodeId, shotId, stageId } = task.request;
  return `You are a Frameboard stage agent. Your whole job is ONE stage of ONE shot: episode ${episodeId}, shot ${shotId}, stage ${stageId}.
- Work only with: this stage folder (${task.stageDir}), shot.md and speech.md of this shot, the playbooks the task names, the ComfyUI queue folder for jobs, and the library folder of this stage (read only).
- Do not open other shots, other stages of this shot, other episodes, the board code, settings, git, AGENTS.md or CLAUDE.md. Do not search the disk.
- Do not start, prepare or plan any other stage. Do not watch for new requests and do not wait for the user's approval.
- When this stage's task is finished, or you have to stop, do what the task says with agent_request.json and end. Keep the answer short.`;
}

/**
 * Аргументы и папка запуска `claude -p` для этапа. Ничего не запускает.
 * viaShell — claude.cmd: аргументы идут через cmd, длинный текст с кавычками и переводами строк туда нельзя.
 */
export function claudeInvocation(task: AgentTask, viaShell = false): { args: string[]; cwd: string; stdin?: string } {
  const model = task.request?.model || defaultClaudeModel();
  const isolation = ["--strict-mcp-config", "--no-session-persistence"];
  if (task.mode === "text") {
    // Чистый вызов модели: без инструментов, MCP и системного промпта Claude Code — один запрос, один ответ.
    const fits = !viaShell && task.system.length <= SYSTEM_ARG_LIMIT;
    return {
      args: [
        "-p",
        "--model",
        model,
        "--output-format",
        "json",
        "--tools",
        "",
        ...isolation,
        "--system-prompt",
        fits ? task.system.trim() : "Follow the instructions at the top of the message.",
      ],
      cwd: isolatedCwd(),
      stdin: fits ? `${task.user.trim()}\n` : textPrompt(task),
    };
  }
  const taskFile = `${task.stageDir}/llm_task.md`.replace(/\\/g, "/");
  const root = task.projectRoot.replace(/\\/g, "/");
  return {
    args: [
      "-p",
      `Выполни задачу из файла ${taskFile}. Файл самодостаточный, других инструкций не будет. Относительные пути в задаче (playbooks/…, data/…, docs/…) считай от корня проекта ${root}.`,
      "--model",
      model,
      "--output-format",
      "stream-json",
      "--verbose",
      // Без настроек пользователя и проекта; файловые инструменты — только в папках --add-dir.
      "--restricted",
      "--tools",
      CLAUDE_AGENT_TOOLS,
      "--allowedTools",
      CLAUDE_AGENT_TOOLS,
      ...isolation,
      "--append-system-prompt",
      viaShell ? agentScopeRules(task).replace(/\s*\n\s*/g, " ") : agentScopeRules(task),
      "--add-dir",
      ...agentScopeDirs(task),
    ],
    cwd: isolatedCwd(),
  };
}

/** Текст ошибки из JSON-ответа claude (поле result), иначе начало вывода. */
function claudeFailure(code: number | null, stdout: string, stderr: string): string {
  let detail = (stderr || stdout).trim();
  try {
    const data = JSON.parse(stdout) as { result?: string; subtype?: string };
    if (data.result) detail = data.result;
    else if (data.subtype) detail = data.subtype;
  } catch {
    // не JSON
  }
  return `claude вышел с кодом ${code}: ${detail.slice(0, 500)}`;
}

const manualProvider: BoardAgentProvider = {
  id: "manual",
  label: "Вручную (чат читает файлы)",
  modes: ["manual"],
  async check() {
    return { available: true };
  },
  async run() {
    return { status: "error", error: "Ручной режим доска не запускает: агент в чате сам ставит done" };
  },
};

/** Модели, установленные в Ollama. null — Ollama не отвечает. */
async function ollamaTags(): Promise<string[] | { error: string }> {
  try {
    const response = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return { error: `Ollama ответил ${response.status}` };
    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    return (data.models ?? []).map((item) => item.name || "").filter(Boolean);
  } catch {
    return { error: `Ollama не отвечает: ${ollamaUrl()}` };
  }
}

const ollamaProvider: BoardAgentProvider = {
  id: "ollama",
  label: "Локальный агент (Ollama)",
  modes: ["text"],
  configError(model) {
    return model || ollamaModel() ? null : "Для Ollama не выбрана модель";
  },
  async check() {
    const names = await ollamaTags();
    if (!Array.isArray(names)) return { available: false, reason: names.error };
    if (!names.length) return { available: false, reason: "В Ollama нет ни одной модели" };
    const configured = ollamaModel();
    const fallback =
      configured && (names.includes(configured) || names.includes(`${configured}:latest`))
        ? names.find((name) => name === configured || name === `${configured}:latest`)!
        : names[0];
    return {
      available: true,
      models: names.map((name) => ({ id: name, label: name.replace(/:latest$/, "") })),
      defaultModel: fallback,
    };
  },
  async run(task, signal) {
    const model = task.request?.model || ollamaModel();
    if (!model) return { status: "error", error: "Для Ollama не выбрана модель" };
    const response = await fetch(`${ollamaUrl()}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        messages: [
          { role: "system", content: task.system },
          { role: "user", content: task.user },
        ],
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      let detail = body.slice(0, 300);
      try {
        detail = (JSON.parse(body) as { error?: string }).error || detail;
      } catch {
        // не JSON
      }
      return { status: "error", error: `Ollama: ${response.status} ${detail}`.trim() };
    }
    const data = JSON.parse(body) as { message?: { content?: string } };
    const prompt = cleanPromptText(data.message?.content ?? "");
    if (!prompt) return { status: "error", error: "Ollama вернул пустой ответ" };
    return { status: "done", prompt };
  },
};

/** Короткий итог stream-json: тексты ассистента и финальный результат. */
function summarizeStream(stdout: string): { log: string; isError: boolean; result: string } {
  const parts: string[] = [];
  let result = "";
  let isError = false;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        is_error?: boolean;
        result?: string;
        message?: { content?: Array<{ type?: string; text?: string; name?: string }> };
      };
      if (event.type === "assistant") {
        for (const block of event.message?.content ?? []) {
          if (block.type === "text" && block.text?.trim()) parts.push(block.text.trim());
          if (block.type === "tool_use" && block.name) parts.push(`→ ${block.name}`);
        }
      } else if (event.type === "result") {
        result = event.result ?? "";
        isError = event.is_error === true;
      }
    } catch {
      parts.push(line);
    }
  }
  return { log: parts.join("\n"), isError, result };
}

const claudeProvider: BoardAgentProvider = {
  id: "claude",
  label: "Claude Code",
  modes: ["text", "agent"],
  configError(model) {
    return !model || CLAUDE_MODELS.some((item) => item.id === model) ? null : `Неизвестная модель Claude: ${model}`;
  },
  async check() {
    const bin = claudeBin();
    const models = { models: CLAUDE_MODELS, defaultModel: defaultClaudeModel() };
    return resolveExecutable(bin)
      ? { available: true, ...models }
      : { available: false, reason: `Не найден ${bin}. Путь к CLI задаётся FRAMEBOARD_CLAUDE_BIN`, ...models };
  },
  async run(task, signal): Promise<AgentResult> {
    const bin = resolveExecutable(claudeBin());
    if (!bin) {
      return { status: "error", error: `Не найден ${claudeBin()}. Путь к CLI задаётся FRAMEBOARD_CLAUDE_BIN` };
    }

    const call = claudeInvocation(task, process.platform === "win32" && /\.(cmd|bat)$/i.test(bin));
    if (task.mode === "text") {
      const out = await runProcess(bin, call.args, { cwd: call.cwd, stdin: call.stdin, signal });
      if (out.code !== 0) return { status: "error", error: claudeFailure(out.code, out.stdout, out.stderr) };
      let data: { result?: string; is_error?: boolean };
      try {
        data = JSON.parse(out.stdout);
      } catch {
        return { status: "error", error: "claude вернул не JSON" };
      }
      if (data.is_error) return { status: "error", error: `claude: ${data.result || "ошибка"}` };
      const prompt = cleanPromptText(data.result ?? "");
      return prompt ? { status: "done", prompt } : { status: "error", error: "claude вернул пустой ответ" };
    }

    const out = await runProcess(bin, call.args, { cwd: call.cwd, signal });
    const summary = summarizeStream(out.stdout);
    const log = [summary.log, summary.result, out.stderr.trim()].filter(Boolean).join("\n\n");
    if (out.code === 0 && !summary.isError) return { status: "done", log };
    return {
      status: "error",
      log,
      error: `claude вышел с кодом ${out.code}${summary.result ? `: ${summary.result.slice(0, 300)}` : ""}`,
    };
  },
};

const BUILTIN: Record<AgentProviderId, BoardAgentProvider> = {
  manual: manualProvider,
  ollama: ollamaProvider,
  claude: claudeProvider,
};

const OVERRIDE_KEY = "__frameboardAgentProviders";

function overrides(): Map<AgentProviderId, BoardAgentProvider> {
  const g = globalThis as typeof globalThis & { [OVERRIDE_KEY]?: Map<AgentProviderId, BoardAgentProvider> };
  if (!g[OVERRIDE_KEY]) g[OVERRIDE_KEY] = new Map();
  return g[OVERRIDE_KEY]!;
}

/** Подмена провайдера (тесты). null — вернуть встроенный. */
export function overrideAgentProvider(id: AgentProviderId, provider: BoardAgentProvider | null): void {
  if (provider) overrides().set(id, provider);
  else overrides().delete(id);
}

export function getAgentProvider(id: AgentProviderId): BoardAgentProvider {
  return overrides().get(id) ?? BUILTIN[id];
}

/** Ответ `GET /api/agent/providers`. */
export async function listAgentProviders(): Promise<AgentProviderInfo[]> {
  const fallback = defaultProviderId();
  const ids: AgentProviderId[] = ["manual", "ollama", "claude"];
  return Promise.all(
    ids.map(async (id) => {
      const provider = getAgentProvider(id);
      let checked: Awaited<ReturnType<BoardAgentProvider["check"]>>;
      try {
        checked = await provider.check();
      } catch (error) {
        checked = { available: false, reason: error instanceof Error ? error.message : "Проверка упала" };
      }
      return {
        id,
        label: provider.label,
        modes: [...provider.modes] as AgentMode[],
        available: checked.available,
        reason: checked.available ? null : checked.reason ?? null,
        isDefault: id === fallback,
        models: checked.models ?? [],
        defaultModel: checked.defaultModel ?? null,
      };
    }),
  );
}
