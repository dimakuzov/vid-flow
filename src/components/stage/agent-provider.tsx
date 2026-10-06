"use client";

import { useEffect, useState } from "react";
import type {
  AgentMode,
  AgentProviderId,
  AgentProviderInfo,
} from "@/lib/contracts/agent-request";

export const PROVIDER_LABELS: Record<AgentProviderId, string> = {
  manual: "Агент в чате",
  ollama: "Ollama",
  claude: "Claude",
};

const STORAGE_KEY = "frameboard.agentProvider";

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Выбор просто не запомнится.
  }
}

/** Провайдер умеет режим этапа. manual подходит всегда. */
function supports(provider: AgentProviderInfo, mode: AgentMode): boolean {
  return provider.modes.includes(mode) || provider.modes.includes("manual");
}

function usable(provider: AgentProviderInfo | undefined, mode: AgentMode): boolean {
  return Boolean(provider && provider.available && supports(provider, mode));
}

/**
 * Провайдеры агента (`GET /api/agent/providers`). Нет маршрута — `providers: null`,
 * селектор не показывается, запрос уходит без `provider`.
 * `mode` — что нужно этапу: text, если у него есть доступный воркфлоу доски, иначе agent.
 */
export function useAgentProviders(mode: AgentMode) {
  const [providers, setProviders] = useState<AgentProviderInfo[] | null>(null);
  const [preferred, setPreferred] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    fetch("/api/agent/providers", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as unknown;
        if (stopped || !Array.isArray(data)) return;
        setProviders(data as AgentProviderInfo[]);
        setPreferred(readStored());
      })
      .catch(() => {
        // Маршрута нет — селектор не показываем.
      });
    return () => {
      stopped = true;
    };
  }, []);

  const byId = (id: string | null | undefined) => providers?.find((item) => item.id === id);
  const selected = providers
    ? ([
        byId(preferred),
        providers.find((item) => item.isDefault),
        byId("manual"),
        ...providers,
      ].find((item) => usable(item, mode)) ?? null)
    : null;

  return {
    providers,
    selected: selected?.id ?? null,
    choose(id: string) {
      setPreferred(id);
      writeStored(id);
    },
  };
}

export function ProviderSelect({
  id,
  providers,
  selected,
  mode,
  disabled,
  onChoose,
}: {
  id: string;
  providers: AgentProviderInfo[];
  selected: string | null;
  mode: AgentMode;
  disabled?: boolean;
  onChoose: (id: string) => void;
}) {
  return (
    <div className="grid min-w-0 gap-1 text-xs text-stone-600">
      <label htmlFor={id}>Кто выполняет</label>
      <select
        id={id}
        value={selected ?? ""}
        disabled={disabled}
        onChange={(event) => onChoose(event.target.value)}
        className="h-9 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 text-sm text-stone-900 disabled:opacity-60"
      >
        {providers.map((provider) => {
          const reason = !provider.available
            ? provider.reason || "недоступен"
            : !supports(provider, mode)
              ? mode === "agent"
                ? "не умеет работать с файлами этого этапа"
                : "не умеет этот режим"
              : "";
          return (
            <option key={provider.id} value={provider.id} disabled={Boolean(reason)}>
              {provider.label || PROVIDER_LABELS[provider.id] || provider.id}
              {reason ? ` — ${reason}` : ""}
            </option>
          );
        })}
      </select>
    </div>
  );
}
