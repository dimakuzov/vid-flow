"use client";

import { useT } from "@/components/language";
import { Button } from "@/components/ui/button";
import type { AgentMode, AgentProviderInfo } from "@/lib/contracts/agent-request";
import { providerName, type Translate } from "@/lib/i18n";
import type { StageDetail } from "@/lib/series/types";
import { agentLabel, ProviderSelect } from "./agent-provider";

function requestStatusText(request: NonNullable<StageDetail["agentRequest"]>, tr: Translate): string {
  const provider = providerName(tr, request.provider ?? "manual");
  switch (request.status) {
    case "pending":
      return tr("agent.pending", { provider });
    case "running":
      return tr("agent.running", { provider });
    case "done":
      return tr("agent.done", { provider });
    case "cancelled":
      return tr("agent.cancelled");
    case "error":
      return tr("agent.failed", { provider });
  }
}

/** «Отправить агенту»: провайдер, кнопка и статус последнего запроса. */
export function AgentPanel({
  detail,
  disabled,
  mode,
  providers,
  provider,
  onChooseProvider,
  model,
  onChooseModel,
  isShotAgent,
  rememberForShot,
  onRememberForShot,
  onSend,
  takes,
  onTakes,
}: {
  detail: StageDetail;
  disabled: boolean;
  mode: AgentMode;
  providers: AgentProviderInfo[] | null;
  provider: string | null;
  onChooseProvider: (id: string) => void;
  model: string | null;
  onChooseModel: (id: string) => void;
  /** Выбор совпадает с агентом кадра. */
  isShotAgent: boolean;
  /** Галка «запомнить для кадра»: выбор станет агентом кадра (agent.json). */
  rememberForShot: boolean;
  onRememberForShot: (value: boolean) => void;
  onSend: () => void;
  /** Сколько файлов с тем же промптом. null — списка нет (финал). */
  takes: number | null;
  onTakes: (count: number) => void;
}) {
  const t = useT();
  const request = detail.agentRequest;
  const shotAgent = detail.shotAgent ? agentLabel(providers, detail.shotAgent, t) : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        {providers?.length ? (
          <div className="w-full min-w-0 sm:w-64">
            <ProviderSelect
              id="agent-provider"
              providers={providers}
              selected={provider}
              mode={mode}
              disabled={disabled || detail.state.busy}
              onChoose={onChooseProvider}
              model={model}
              onChooseModel={onChooseModel}
            />
          </div>
        ) : null}
        <Button disabled={disabled || detail.state.busy} onClick={onSend}>
          {t("agent.send")}
        </Button>
        {takes != null ? (
          <label className="text-xs text-stone-600">
            {t("agent.takes")}
            <select
              aria-label={t("agent.takesLabel")}
              title={t("agent.takesTitle")}
              value={takes}
              disabled={disabled || detail.state.busy}
              onChange={(event) => onTakes(Number(event.target.value))}
              className="mt-1 block h-9 rounded-lg border border-stone-300 bg-white px-2 text-sm text-stone-900"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {providers?.length ? (
        <div className="space-y-1 text-xs text-stone-600">
          <p>{t("agent.shot", { name: shotAgent ?? t("agent.unassigned") })}</p>
          {provider && !isShotAgent ? (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={rememberForShot}
                disabled={disabled || detail.state.busy}
                onChange={(event) => onRememberForShot(event.target.checked)}
              />
              {shotAgent ? t("agent.rememberOther") : t("agent.remember")}
            </label>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs leading-5 text-stone-500">
        {t("agent.help")}
        {detail.stageId === "characters" ? t("agent.helpCharacters") : ""}
        {t("agent.helpWatch")}
      </p>
      {request ? (
        <div className="text-xs leading-5 text-stone-500">
          <p>
            {requestStatusText(request, t)}{" "}
            {request.refsChangedByUser ? t("agent.refsChanged") : t("agent.refsSame")}
          </p>
          {request.status === "error" && request.error ? (
            <p className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-900">
              {request.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
