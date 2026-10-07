import type { AgentMode, AgentProviderId } from "../contracts/agent-request";

/*
 * Настройка провайдеров агента (docs/contracts/agent-request.md, «Настройка»).
 * Читается при каждом вызове: тесты и `next dev` меняют окружение без перезапуска модуля.
 */

const PROVIDER_IDS: AgentProviderId[] = ["manual", "ollama", "claude"];

export function isProviderId(value: unknown): value is AgentProviderId {
  return typeof value === "string" && (PROVIDER_IDS as string[]).includes(value);
}

export function defaultProviderId(): AgentProviderId {
  const raw = process.env.FRAMEBOARD_AGENT_PROVIDER?.trim();
  return isProviderId(raw) ? raw : "manual";
}

export function ollamaUrl(): string {
  return (process.env.FRAMEBOARD_OLLAMA_URL?.trim() || "http://127.0.0.1:11434").replace(/\/+$/, "");
}

export function ollamaModel(): string | null {
  return process.env.FRAMEBOARD_OLLAMA_MODEL?.trim() || null;
}

/**
 * Сколько запросов одного провайдера идут одновременно. Остальные ждут в pending,
 * фоновый цикл запускает их по мере освобождения. FRAMEBOARD_AGENT_PARALLEL — для всех провайдеров.
 * По умолчанию: Ollama — 1 (модель одна на видеокарте), Claude — 2.
 */
export function providerParallel(id: AgentProviderId): number {
  const value = Number(process.env.FRAMEBOARD_AGENT_PARALLEL);
  if (Number.isFinite(value) && value >= 1) return Math.floor(value);
  return id === "claude" ? 2 : 1;
}

/** Модели Claude Code на выбор. Первая — по умолчанию, если не задана FRAMEBOARD_CLAUDE_MODEL. */
export const CLAUDE_MODELS = [
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

export function defaultClaudeModel(): string {
  const configured = process.env.FRAMEBOARD_CLAUDE_MODEL?.trim();
  return configured || CLAUDE_MODELS[0].id;
}

export function claudeBin(): string {
  return process.env.FRAMEBOARD_CLAUDE_BIN?.trim() || "claude";
}

function minutes(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return (Number.isFinite(value) && value > 0 ? value : fallback) * 60 * 1000;
}

/** Предел времени режима. manual — тот же, что у фонового цикла (бриф 1). */
export function modeTimeoutMs(mode: AgentMode): number {
  if (mode === "text") return minutes("FRAMEBOARD_AGENT_TEXT_TIMEOUT_MIN", 5);
  if (mode === "agent") return minutes("FRAMEBOARD_AGENT_RUN_TIMEOUT_MIN", 30);
  return minutes("FRAMEBOARD_AGENT_TIMEOUT_MIN", 60);
}

export function formatMinutes(ms: number): string {
  const value = ms / 60000;
  return value >= 1 ? `${Math.round(value)} мин` : `${Math.max(1, Math.round(ms / 1000))} с`;
}
