"use client";

import { Button } from "@/components/ui/button";
import type { AgentMode, AgentProviderInfo } from "@/lib/contracts/agent-request";
import type { StageDetail } from "@/lib/series/types";
import { PROVIDER_LABELS, ProviderSelect } from "./agent-provider";

function requestStatusText(request: NonNullable<StageDetail["agentRequest"]>): string {
  const provider = PROVIDER_LABELS[request.provider ?? "manual"];
  switch (request.status) {
    case "pending":
      return `Последний запрос ждёт исполнителя (${provider}).`;
    case "running":
      return `Последний запрос выполняется (${provider}).`;
    case "done":
      return `Последний запрос выполнен (${provider}).`;
    case "cancelled":
      return "Последний запрос отменён.";
    case "error":
      return `Последний запрос упал (${provider}).`;
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
  onSend,
}: {
  detail: StageDetail;
  disabled: boolean;
  mode: AgentMode;
  providers: AgentProviderInfo[] | null;
  provider: string | null;
  onChooseProvider: (id: string) => void;
  onSend: () => void;
}) {
  const request = detail.agentRequest;
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
            />
          </div>
        ) : null}
        <Button disabled={disabled || detail.state.busy} onClick={onSend}>
          Отправить агенту
        </Button>
      </div>
      <p className="text-xs leading-5 text-stone-500">
        Кнопка сохраняет prompt, refs и workflow, отдаёт рекомендацию агенту и очищает поле. Пока
        агент работает, этап закрыт. Когда он перепишет промпт, доска сама ставит этап в Comfy. На
        персонажах прогон ставит агент. «Закончить кадр» останавливает проверку входящих. Она также
        останавливается, когда в final_render есть утверждённое видео.
      </p>
      {request ? (
        <div className="text-xs leading-5 text-stone-500">
          <p>
            {requestStatusText(request)}{" "}
            {request.refsChangedByUser
              ? "Референсы менялись вручную."
              : "Референсы вручную не менялись."}
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
