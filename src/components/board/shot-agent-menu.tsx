"use client";

import { useState } from "react";
import { useLang, useT } from "@/components/language";
import { agentLabel, ProviderSelect, useAgentProviders, useProviderList } from "@/components/stage/agent-provider";
import { errorText, requestJson } from "@/components/stage/api";
import { clockLocale, stageName, type Lang, type Translate } from "@/lib/i18n";
import { STAGES, type StageId } from "@/lib/series/constants";
import type { ShotSummary } from "@/lib/series/types";
import { BulkResultView, type BulkResult } from "./bulk-menu";
import { useFloatingMenu } from "./floating-menu";

/** Следующий этап кадра, как его выбирает доска: первый неутверждённый из нужных кадру. */
function nextStageOf(shot: ShotSummary): StageId | null {
  for (const stageId of STAGES) {
    if (stageId === "characters" && !shot.characters.length) continue;
    if (stageId === "location" && !shot.location.trim()) continue;
    if (shot.stages[stageId].status !== "approved") return stageId;
  }
  return null;
}

function time(iso: string, lang: Lang): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(clockLocale(lang), { hour: "2-digit", minute: "2-digit" });
}

/** «работает: Персонажи, с 14:05» / «ждёт очереди: Локация» / «ждёт агента в чате: Локация» / «свободен». */
export function activityText(shot: ShotSummary, tr: Translate, lang: Lang): string {
  const activity = shot.agentActivity;
  if (!activity) return tr("shot.free");
  const stage = stageName(tr, activity.stageId);
  if (activity.status === "running") return tr("shot.running", { stage, time: time(activity.since, lang) });
  if (activity.provider === "manual") return tr("shot.waitingChat", { stage });
  return tr("shot.waitingQueue", { stage });
}

/** Агент кадра и его состояние под заголовком кадра. */
export function ShotAgentLine({ shot }: { shot: ShotSummary }) {
  const lang = useLang();
  const t = useT();
  const providers = useProviderList();
  const busy = shot.agentActivity?.status === "running";
  return (
    <div className="mt-2 text-xs leading-snug">
      <span className={shot.agent ? "text-stone-800" : "text-stone-400"}>
        {shot.agent ? agentLabel(providers, shot.agent, t) : t("shot.noAgent")}
      </span>
      {shot.agent || shot.agentActivity ? (
        <span className={busy ? "text-teal-800" : "text-stone-500"}> — {activityText(shot, t, lang)}</span>
      ) : null}
    </div>
  );
}

/** «▶ Агент» на кадре: выбрать агента кадра, сохранить, запустить следующий этап или остановить. */
export function ShotAgentMenu({
  episodeId,
  shot,
  onDone,
}: {
  episodeId: string;
  shot: ShotSummary;
  onDone: () => void;
}) {
  const lang = useLang();
  const t = useT();
  const { anchor, open, menuRef, toggle, close } = useFloatingMenu(288);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState("");
  const nextStage = nextStageOf(shot);
  // Персонажей агент делает сам: выбор ограничен теми, кто умеет работать с файлами.
  const mode = nextStage === "characters" ? "agent" : "text";
  const agent = useAgentProviders(mode, shot.agent);
  const shotApi = `/api/episodes/${encodeURIComponent(episodeId)}/shots/${encodeURIComponent(shot.id)}`;

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNote("");
    setResult(null);
    try {
      await work();
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const choice = { provider: agent.selected ?? undefined, model: agent.model ?? undefined };

  const save = () =>
    act(async () => {
      await requestJson(`${shotApi}/agent`, { method: "PUT", body: choice, fallbackError: t("shot.saveFailed") });
      setNote(t("shot.saved"));
    });

  const runNext = () =>
    act(async () => {
      setResult(
        await requestJson<BulkResult>(`${shotApi}/next-stage`, {
          method: "POST",
          body: choice,
          fallbackError: t("bulk.runFailed"),
        }),
      );
    });

  const stop = () =>
    act(async () => {
      const data = await requestJson<{ stopped: unknown[] }>("/api/agent/runs/stop", {
        method: "POST",
        body: { episodeId, shotId: shot.id },
        fallbackError: t("shot.stopFailed"),
      });
      setNote(data.stopped.length ? t("shot.stopped", { n: data.stopped.length }) : t("shot.notRunning"));
    });

  return (
    <div className="mt-1 normal-case tracking-normal">
      <button
        type="button"
        onClick={(event) => toggle(event.currentTarget)}
        aria-expanded={open}
        className="rounded-md border border-teal-800/30 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-900 hover:bg-teal-100"
      >
        {t("shot.agentButton")}
      </button>
      {anchor ? (
        <div
          ref={menuRef}
          style={{ top: anchor.top, bottom: anchor.bottom, left: anchor.left, maxHeight: anchor.maxHeight }}
          className="fixed z-30 w-72 space-y-3 overflow-y-auto rounded-xl border border-stone-300 bg-white p-3 text-left text-xs font-normal text-stone-700 shadow-lg"
        >
          <div>
            <div className="text-sm font-semibold text-stone-900">{t("shot.agentTitle", { id: shot.id })}</div>
            <p className="mt-1 leading-snug">
              {t("shot.agentLead", { activity: activityText(shot, t, lang) })}{" "}
              {nextStage ? t("shot.next", { stage: stageName(t, nextStage) }) : t("shot.allApproved")}
            </p>
          </div>
          {agent.providers ? (
            <ProviderSelect
              id={`shot-agent-${shot.id}`}
              providers={agent.providers}
              selected={agent.selected}
              mode={mode}
              disabled={busy}
              onChoose={agent.choose}
              model={agent.model}
              onChooseModel={agent.chooseModel}
            />
          ) : (
            <p className="text-stone-500">{t("provider.listFailed")}</p>
          )}
          <div className="grid gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !agent.selected || agent.isInitial}
              className="h-8 rounded-lg border border-teal-800/40 px-3 text-sm text-teal-900 hover:bg-teal-50 disabled:opacity-50"
            >
              {t("shot.save")}
            </button>
            <button
              type="button"
              onClick={runNext}
              disabled={busy || !nextStage}
              className="h-8 rounded-lg bg-teal-800 px-3 text-sm font-medium text-white hover:bg-teal-900 disabled:opacity-60"
            >
              {busy ? "…" : t("shot.runNext")}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={stop}
                disabled={busy || !shot.agentActivity}
                className="h-8 flex-1 rounded-lg border border-red-300 px-3 text-sm text-red-900 hover:bg-red-50 disabled:opacity-50"
              >
                {t("shot.stop")}
              </button>
              <button
                type="button"
                onClick={close}
                className="h-8 rounded-lg border border-stone-300 px-3 text-sm text-stone-700"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
          {error ? <p className="text-red-800">{error}</p> : null}
          {note ? <p>{note}</p> : null}
          {result ? <BulkResultView result={result} withStage /> : null}
        </div>
      ) : null}
    </div>
  );
}
