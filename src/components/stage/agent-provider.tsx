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

function modelKey(provider: string): string {
  return `frameboard.agentModel.${provider}`;
}

function readStoredModel(provider: string): string | null {
  try {
    return window.localStorage.getItem(modelKey(provider));
  } catch {
    return null;
  }
}

function writeStoredModel(provider: string, model: string) {
  try {
    window.localStorage.setItem(modelKey(provider), model);
  } catch {
    // Выбор просто не запомнится.
  }
}

/** Модель провайдера: запомненная, если она ещё есть в списке, иначе по умолчанию провайдера. */
export function pickModel(provider: AgentProviderInfo | undefined, stored: string | null): string | null {
  if (!provider?.models?.length) return null;
  if (stored && provider.models.some((item) => item.id === stored)) return stored;
  return provider.defaultModel ?? provider.models[0].id;
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

/** Провайдеры живут недолго (Ollama могли включить): один запрос на все меню таблицы, потом заново. */
const PROVIDERS_TTL_MS = 30_000;
let providersCache: { at: number; promise: Promise<AgentProviderInfo[] | null> } | null = null;

function loadProviders(): Promise<AgentProviderInfo[] | null> {
  if (providersCache && Date.now() - providersCache.at < PROVIDERS_TTL_MS) return providersCache.promise;
  const promise = fetch("/api/agent/providers", { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as AgentProviderInfo[]) : null;
    })
    .catch(() => null);
  providersCache = { at: Date.now(), promise };
  return promise;
}

/** Список провайдеров для подписей (агент в заголовке кадра). null — ещё не загружен или маршрута нет. */
export function useProviderList(): AgentProviderInfo[] | null {
  const [providers, setProviders] = useState<AgentProviderInfo[] | null>(null);
  useEffect(() => {
    let stopped = false;
    loadProviders().then((data) => {
      if (!stopped && data) setProviders(data);
    });
    return () => {
      stopped = true;
    };
  }, []);
  return providers;
}

/** «Claude Code · Sonnet 5.5». Без списка провайдеров — id. */
export function agentLabel(
  providers: AgentProviderInfo[] | null,
  agent: { provider: string; model: string | null },
): string {
  const provider = providers?.find((item) => item.id === agent.provider);
  const name = provider?.label || PROVIDER_LABELS[agent.provider as AgentProviderId] || agent.provider;
  const modelId = agent.model ?? provider?.defaultModel ?? null;
  if (!modelId) return name;
  const model = provider?.models?.find((item) => item.id === modelId)?.label ?? modelId;
  return `${name} · ${model}`;
}

/**
 * Провайдеры агента (`GET /api/agent/providers`). Нет маршрута — `providers: null`,
 * селектор не показывается, запрос уходит без `provider`.
 * `mode` — что нужно этапу: text, если у него есть доступный воркфлоу доски, иначе agent.
 * `initial` — агент кадра: выбран сразу, пока в этом меню не выбрали другого.
 * Без него — последний выбор в браузере.
 */
export function useAgentProviders(mode: AgentMode, initial?: { provider: string; model: string | null } | null) {
  const [providers, setProviders] = useState<AgentProviderInfo[] | null>(null);
  const [preferred, setPreferred] = useState<string | null>(null);
  const [storedModels, setStoredModels] = useState<Record<string, string | null>>({});
  // Выбор в этом меню. Пока пусто — агент кадра, иначе запомненный в браузере.
  const [picked, setPicked] = useState<{ provider: string | null; models: Record<string, string> }>({
    provider: null,
    models: {},
  });

  useEffect(() => {
    let stopped = false;
    loadProviders().then((data) => {
      // Маршрута нет — селектор не показываем.
      if (stopped || !data) return;
      setProviders(data);
      setPreferred(readStored());
      setStoredModels(Object.fromEntries(data.map((item) => [item.id, readStoredModel(item.id)])));
    });
    return () => {
      stopped = true;
    };
  }, []);

  const byId = (id: string | null | undefined) => providers?.find((item) => item.id === id);
  const selected = providers
    ? ([
        byId(picked.provider),
        byId(initial?.provider),
        byId(preferred),
        providers.find((item) => item.isDefault),
        byId("manual"),
        ...providers,
      ].find((item) => usable(item, mode)) ?? null)
    : null;

  const fromShot = selected && selected.id === initial?.provider ? initial.model : null;
  const model = selected
    ? pickModel(selected, picked.models[selected.id] ?? fromShot ?? storedModels[selected.id] ?? null)
    : null;

  return {
    providers,
    selected: selected?.id ?? null,
    /** Модель выбранного провайдера. null — у провайдера нет выбора модели. */
    model,
    /** Выбор совпадает с агентом кадра. */
    isInitial: Boolean(
      initial && selected?.id === initial.provider && pickModel(selected, initial.model) === model,
    ),
    choose(id: string) {
      setPicked((current) => ({ ...current, provider: id }));
      setPreferred(id);
      writeStored(id);
    },
    chooseModel(id: string) {
      if (!selected) return;
      setPicked((current) => ({
        provider: current.provider ?? selected.id,
        models: { ...current.models, [selected.id]: id },
      }));
      setStoredModels((current) => ({ ...current, [selected.id]: id }));
      writeStoredModel(selected.id, id);
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
  model,
  onChooseModel,
}: {
  id: string;
  providers: AgentProviderInfo[];
  selected: string | null;
  mode: AgentMode;
  disabled?: boolean;
  onChoose: (id: string) => void;
  /** Выбранная модель и её смена. Нет onChooseModel — выбора модели не показываем. */
  model?: string | null;
  onChooseModel?: (id: string) => void;
}) {
  const models = providers.find((item) => item.id === selected)?.models ?? [];
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
      {onChooseModel && models.length ? (
        <>
          <label htmlFor={`${id}-model`}>Модель</label>
          <select
            id={`${id}-model`}
            value={model ?? ""}
            disabled={disabled}
            onChange={(event) => onChooseModel(event.target.value)}
            className="h-9 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 text-sm text-stone-900 disabled:opacity-60"
          >
            {models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  );
}
