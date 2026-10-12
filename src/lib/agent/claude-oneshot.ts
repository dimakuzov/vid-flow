import fs from "fs";
import os from "os";
import path from "path";
import type { AgentUsage } from "../contracts/agent-request";
import { claudeBin } from "./config";
import { resolveExecutable, runProcess } from "./process";
import { claudeUsage } from "./providers";

/*
 * Один запрос к Claude Code вне этапа: описание картинки и действие кадра.
 * Весь текст идёт через stdin (у claude.cmd аргументы проходят через cmd). Картинку claude
 * открывает инструментом Read, и только в отдельной временной папке, куда доска её копирует.
 */

/** Модель действия кадра: сводит сценарий, картинки и замечания — нужна сообразительность. */
export function contextModel(): string {
  return process.env.FRAMEBOARD_CONTEXT_MODEL?.trim() || "claude-sonnet-5-5";
}

/** Модель описаний картинок: только «что на картинке», анализ не нужен — самая дешёвая со зрением. */
export function visionModel(): string {
  return process.env.FRAMEBOARD_VISION_MODEL?.trim() || "claude-haiku-5-5";
}

export interface OneShotRequest {
  /** Задача целиком. */
  prompt: string;
  /** Картинка, которую claude должен посмотреть. Нет — чистый текст, без инструментов. */
  image?: string;
  model?: string;
  signal: AbortSignal;
}

export interface OneShotResult {
  text: string;
  usage: AgentUsage;
  model: string;
}

type OneShot = (request: OneShotRequest) => Promise<OneShotResult>;

const OVERRIDE_KEY = "__frameboardClaudeOneShot";

/** Подмена вызова (тесты). null — настоящий claude. */
export function overrideClaudeOneShot(fn: OneShot | null): void {
  const g = globalThis as typeof globalThis & { [OVERRIDE_KEY]?: OneShot | null };
  g[OVERRIDE_KEY] = fn;
}

function override(): OneShot | null {
  return (globalThis as typeof globalThis & { [OVERRIDE_KEY]?: OneShot | null })[OVERRIDE_KEY] ?? null;
}

/**
 * claude есть на этом компьютере (или вызов подменён). Ничего не запускает.
 * FRAMEBOARD_DESCRIBE=off выключает описания и действие кадра; тесты и скрипты
 * (FRAMEBOARD_LOOPS=off) настоящий claude здесь не зовут.
 */
export function claudeOneShotAvailable(): boolean {
  if (override()) return true;
  if (process.env.FRAMEBOARD_DESCRIBE === "off" || process.env.FRAMEBOARD_LOOPS === "off") return false;
  return Boolean(resolveExecutable(claudeBin()));
}

const SYSTEM = "Follow the task in the user message exactly. Reply with the requested text only.";

export async function claudeOneShot(request: OneShotRequest): Promise<OneShotResult> {
  const fake = override();
  if (fake) return fake(request);
  const bin = resolveExecutable(claudeBin());
  if (!bin) throw new Error(`Не найден ${claudeBin()}. Путь к CLI задаётся FRAMEBOARD_CLAUDE_BIN`);
  const model = request.model || contextModel();

  // Пустая папка вне репозитория: без CLAUDE.md, настроек и памяти проекта.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-oneshot-"));
  let prompt = request.prompt.trim();
  const tools: string[] = [];
  if (request.image) {
    const name = `image${path.extname(request.image).toLowerCase() || ".png"}`;
    fs.copyFileSync(request.image, path.join(cwd, name));
    tools.push("--tools", "Read", "--allowedTools", "Read", "--add-dir", cwd);
    prompt = `First open the image file ${name} in the current folder with the Read tool and look at it carefully.\n\n${prompt}`;
  } else {
    tools.push("--tools", "");
  }
  const args = [
    "-p",
    "--model",
    model,
    "--output-format",
    "json",
    ...tools,
    "--strict-mcp-config",
    "--no-session-persistence",
    "--system-prompt",
    SYSTEM,
  ];
  const started = Date.now();
  try {
    const out = await runProcess(bin, args, {
      cwd,
      stdin: `${prompt}\n`,
      signal: request.signal,
      env: { ...process.env, MAX_THINKING_TOKENS: "0" },
    });
    let data: { result?: string; is_error?: boolean } | null = null;
    try {
      data = JSON.parse(out.stdout);
    } catch {
      data = null;
    }
    const usage = claudeUsage(data as Parameters<typeof claudeUsage>[0], Date.now() - started);
    if (out.code !== 0 || !data || data.is_error) {
      const detail = (data?.result || out.stderr || out.stdout).trim().slice(0, 300);
      throw new Error(`claude вышел с кодом ${out.code}: ${detail}`);
    }
    const text = (data.result ?? "").trim();
    if (!text) throw new Error("claude вернул пустой ответ");
    return { text, usage, model };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}
