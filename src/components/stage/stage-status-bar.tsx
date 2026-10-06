"use client";

import { Button } from "@/components/ui/button";
import { STATUS_LABELS } from "@/lib/series/constants";
import { phaseTone } from "@/lib/series/labels";
import type { StageDetail } from "@/lib/series/types";
import { PROVIDER_LABELS } from "./agent-provider";
import { formatClock, formatElapsed, useNow } from "./use-now";

function queueText(detail: StageDetail): string {
  const job = detail.job;
  if (!job) return "Задание ещё не записано в очередь.";
  if (detail.state.phase === "queued") {
    if (job.queuePosition !== null && job.queuePosition > 0) {
      return `В очереди ComfyUI: ${job.queuePosition}-е место.`;
    }
    return "ComfyUI ещё не принял задание. Если он выключен, задание уйдёт, когда он запустится.";
  }
  if (job.queuePosition === 0 || job.queuePosition === null) return "ComfyUI генерирует. Файлы появятся в output/.";
  return `Принято ComfyUI, место в очереди: ${job.queuePosition}.`;
}

function agentText(detail: StageDetail): string {
  const request = detail.agentRequest;
  if (!request) return "Запрос записан.";
  const provider = PROVIDER_LABELS[request.provider ?? "manual"];
  if (request.status === "running") return `${provider} работает над запросом.`;
  if (request.status === "done") return "Агент закончил. Доска ставит прогон в очередь.";
  if ((request.provider ?? "manual") === "manual") {
    return "Ждём агента в чате: он читает llm_task.md и ставит status: done в agent_request.json.";
  }
  return `Запрос ждёт исполнителя (${provider}).`;
}

const JOB_RESULT: Record<string, string> = {
  done: "готово",
  error: "ошибка",
  cancelled: "отменён",
  pending: "не отправлен",
  running: "не завершён",
};

/** Этап свободен: одна строка о последнем прогоне — когда, чем и сколько файлов. */
function LastJob({ job }: { job: NonNullable<StageDetail["job"]> }) {
  const when = job.finishedAt || job.queuedAt;
  const files = job.files.length;
  return (
    <p className="break-words text-xs text-stone-600">
      Последний прогон: {JOB_RESULT[job.status] ?? job.status}
      {when ? ` · ${formatClock(when)}` : ""}
      {job.workflow ? ` · ${job.workflow}` : ""}
      {files ? ` · файлов: ${files} (${job.files.join(", ")})` : ""}
      {job.status === "error" && job.error ? ` · ${job.error}` : ""}
    </p>
  );
}

/**
 * Полоса состояния этапа: фаза из `state.phase` (не из `job.status`), время, очередь, ошибка.
 * Этап свободен — строка о последнем прогоне.
 */
export function StageStatusBar({
  detail,
  disabled,
  onCancel,
}: {
  detail: StageDetail;
  disabled: boolean;
  onCancel: () => void;
}) {
  const now = useNow();
  const { state, job } = detail;
  if (state.phase === "idle") return job ? <LastJob job={job} /> : null;

  const since = state.phase === "running" && job?.submittedAt ? job.submittedAt : state.since;
  const elapsed = formatElapsed(since, now);
  const nodeErrors = job?.nodeErrors ?? [];
  const errorText = state.error || job?.error || "Операция завершилась ошибкой.";

  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm ${phaseTone(state.phase)}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2 font-medium">
            <span>{STATUS_LABELS[state.phase]}</span>
            {since ? (
              <span className="text-xs font-normal opacity-75">
                с {formatClock(since)}
                {elapsed ? ` · ${elapsed}` : ""}
              </span>
            ) : null}
          </div>
          {state.phase === "agent" ? <p>{agentText(detail)}</p> : null}
          {state.phase === "queued" || state.phase === "running" ? (
            <p>
              {queueText(detail)}
              {job?.workflow ? <span className="opacity-75"> Воркфлоу: {job.workflow}.</span> : null}
            </p>
          ) : null}
          {state.phase === "error" ? (
            <div className="space-y-1">
              <p className="whitespace-pre-wrap break-words">{errorText}</p>
              {nodeErrors.length ? (
                <ul className="list-disc space-y-0.5 pl-5 text-xs">
                  {nodeErrors.map((item, index) => (
                    <li key={`${item.node}-${index}`} className="break-words">
                      <span className="font-medium">
                        {item.classType ? `${item.classType} #${item.node}` : `нода ${item.node}`}
                      </span>
                      : {item.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {job && state.phase !== "agent" ? (
            <p className="break-all text-xs opacity-70">
              {job.id}
              {job.queuedAt ? ` · поставлено ${formatClock(job.queuedAt)}` : ""}
              {job.submittedAt ? ` · принято ${formatClock(job.submittedAt)}` : ""}
            </p>
          ) : null}
        </div>
        {state.phase === "error" ? (
          <Button variant="outline" disabled={disabled} onClick={onCancel}>
            Сбросить ошибку
          </Button>
        ) : (
          <Button variant="destructive" disabled={disabled} onClick={onCancel}>
            Отменить
          </Button>
        )}
      </div>
    </div>
  );
}
