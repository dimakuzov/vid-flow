import type {
  AgentMode,
  AgentProvider,
  AgentProviderId,
  AgentProviderInfo,
  AgentResult,
  AgentTask,
} from "../contracts/agent-request";
import { claudeBin, defaultProviderId, ollamaModel, ollamaUrl } from "./config";
import { resolveExecutable, runProcess } from "./process";

/*
 * Провайдеры агента (docs/contracts/agent-request.md, «Режимы и провайдеры»).
 * check() ничего не запускает и не пишет: только спрашивает Ollama и ищет файл `claude`.
 */

/** Провайдер доски: контракт плюс синхронная проверка настройки (для ответа 400 до записи запроса). */
export interface BoardAgentProvider extends AgentProvider {
  /** Чего не хватает в настройке. null — настроен. Сеть не трогает. */
  configError?(): string | null;
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

const ollamaProvider: BoardAgentProvider = {
  id: "ollama",
  get label() {
    const model = ollamaModel();
    return model ? `Ollama (${model})` : "Ollama";
  },
  modes: ["text"],
  configError() {
    return ollamaModel() ? null : "Для Ollama не задана модель: FRAMEBOARD_OLLAMA_MODEL";
  },
  async check() {
    const model = ollamaModel();
    let names: string[];
    try {
      const response = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (!response.ok) return { available: false, reason: `Ollama ответил ${response.status}` };
      const data = (await response.json()) as { models?: Array<{ name?: string }> };
      names = (data.models ?? []).map((item) => item.name || "").filter(Boolean);
    } catch {
      return { available: false, reason: `Ollama не отвечает: ${ollamaUrl()}` };
    }
    if (!model) {
      return {
        available: false,
        reason: `Не задана модель FRAMEBOARD_OLLAMA_MODEL. Есть: ${names.join(", ") || "(нет моделей)"}`,
      };
    }
    const found = names.includes(model) || names.includes(`${model}:latest`);
    return found ? { available: true } : { available: false, reason: `В Ollama нет модели ${model}` };
  },
  async run(task, signal) {
    const model = ollamaModel();
    if (!model) return { status: "error", error: this.configError?.() ?? "Нет модели Ollama" };
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
  label: "Claude (подписка)",
  modes: ["text", "agent"],
  async check() {
    const bin = claudeBin();
    return resolveExecutable(bin)
      ? { available: true }
      : { available: false, reason: `Не найден ${bin}. Путь к CLI задаётся FRAMEBOARD_CLAUDE_BIN` };
  },
  async run(task, signal): Promise<AgentResult> {
    const bin = resolveExecutable(claudeBin());
    if (!bin) {
      return { status: "error", error: `Не найден ${claudeBin()}. Путь к CLI задаётся FRAMEBOARD_CLAUDE_BIN` };
    }

    if (task.mode === "text") {
      const out = await runProcess(bin, ["-p", "--output-format", "json"], {
        cwd: task.projectRoot,
        stdin: textPrompt(task),
        signal,
      });
      if (out.code !== 0) {
        return { status: "error", error: `claude вышел с кодом ${out.code}: ${(out.stderr || out.stdout).trim().slice(0, 500)}` };
      }
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

    const taskFile = `${task.stageDir}/llm_task.md`.replace(/\\/g, "/");
    const out = await runProcess(
      bin,
      [
        "-p",
        `Выполни задачу из файла ${taskFile}. Файл самодостаточный, других инструкций не будет.`,
        "--output-format",
        "stream-json",
        "--verbose",
        "--allowedTools",
        CLAUDE_AGENT_TOOLS,
      ],
      { cwd: task.projectRoot, signal },
    );
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
      let checked: { available: boolean; reason?: string };
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
      };
    }),
  );
}
