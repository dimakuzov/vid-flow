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
