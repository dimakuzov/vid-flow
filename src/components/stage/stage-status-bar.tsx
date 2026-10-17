"use client";

import { useLang, useT } from "@/components/language";
import { Button } from "@/components/ui/button";
import { providerName, statusName, type Translate } from "@/lib/i18n";
import { phaseTone } from "@/lib/series/labels";
import type { StageDetail } from "@/lib/series/types";
import { formatClock, formatElapsed, useNow } from "./use-now";

function queueText(detail: StageDetail, tr: Translate): string {
  const job = detail.job;
  if (!job) return tr("job.unwritten");
  if (detail.state.phase === "queued") {
    if (job.queuePosition !== null && job.queuePosition > 0) {
      return tr("job.place", { n: job.queuePosition });
    }
    return tr("job.notAccepted");
  }
  if (job.queuePosition === 0 || job.queuePosition === null) return tr("job.generating");
  return tr("job.accepted", { n: job.queuePosition });
}

function agentText(detail: StageDetail, tr: Translate): string {
  const request = detail.agentRequest;
  if (!request) return tr("job.recorded");
  const provider = providerName(tr, request.provider ?? "manual");
  if (request.status === "running") return tr("job.agentWorking", { provider });
  if (request.status === "done") return tr("job.agentDone");
  if ((request.provider ?? "manual") === "manual") return tr("job.waitChat");
  return tr("job.waitRunner", { provider });
}

const JOB_RESULT = {
  done: "job.result.done",
  error: "job.result.error",
  cancelled: "job.result.cancelled",
  pending: "job.result.pending",
  running: "job.result.running",
} as const;

/** Этап свободен: одна строка о последнем прогоне — когда, чем и сколько файлов. */
function LastJob({ job }: { job: NonNullable<StageDetail["job"]> }) {
  const lang = useLang();
  const t = useT();
  const when = job.finishedAt || job.queuedAt;
  const files = job.files.length;
  const result = JOB_RESULT[job.status as keyof typeof JOB_RESULT];
  return (
    <p className="break-words text-xs text-stone-600">
      {t("job.last", { status: result ? t(result) : job.status })}
      {when ? ` · ${formatClock(when, lang)}` : ""}
      {job.workflow ? ` · ${job.workflow}` : ""}
      {files ? t("job.files", { n: files, names: job.files.join(", ") }) : ""}
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
  const lang = useLang();
  const t = useT();
  const now = useNow();
  const { state, job } = detail;
  if (state.phase === "idle") return job ? <LastJob job={job} /> : null;

  const since = state.phase === "running" && job?.submittedAt ? job.submittedAt : state.since;
  const elapsed = formatElapsed(since, now, t);
  const nodeErrors = job?.nodeErrors ?? [];
  const failure = state.error || job?.error || t("job.failed");

  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm ${phaseTone(state.phase)}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2 font-medium">
            <span>{statusName(t, state.phase)}</span>
            {since ? (
              <span className="text-xs font-normal opacity-75">
                {t("time.since", { clock: formatClock(since, lang) })}
                {elapsed ? ` · ${elapsed}` : ""}
              </span>
            ) : null}
          </div>
          {state.phase === "agent" ? <p>{agentText(detail, t)}</p> : null}
          {state.phase === "queued" || state.phase === "running" ? (
            <p>
              {queueText(detail, t)}
              {job?.workflow ? <span className="opacity-75">{t("job.workflow", { name: job.workflow })}</span> : null}
            </p>
          ) : null}
          {state.phase === "error" ? (
            <div className="space-y-1">
              <p className="whitespace-pre-wrap break-words">{failure}</p>
              {nodeErrors.length ? (
                <ul className="list-disc space-y-0.5 pl-5 text-xs">
                  {nodeErrors.map((item, index) => (
                    <li key={`${item.node}-${index}`} className="break-words">
                      <span className="font-medium">
                        {item.classType ? `${item.classType} #${item.node}` : t("job.node", { id: item.node })}
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
              {job.queuedAt ? t("job.queuedAt", { time: formatClock(job.queuedAt, lang) }) : ""}
              {job.submittedAt ? t("job.acceptedAt", { time: formatClock(job.submittedAt, lang) }) : ""}
            </p>
          ) : null}
        </div>
        {state.phase === "error" ? (
          <Button variant="outline" disabled={disabled} onClick={onCancel}>
            {t("job.reset")}
          </Button>
        ) : (
          <Button variant="destructive" disabled={disabled} onClick={onCancel}>
            {t("job.cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}
