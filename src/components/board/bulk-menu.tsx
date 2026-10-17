"use client";

import { useState } from "react";
import { useT } from "@/components/language";
import { ProviderSelect, useAgentProviders } from "@/components/stage/agent-provider";
import { errorText, requestJson } from "@/components/stage/api";
import { stageName, type Translate } from "@/lib/i18n";
import type { StageId } from "@/lib/series/constants";
import { useFloatingMenu } from "./floating-menu";

interface BulkItem {
  shotId: string;
  stageId: StageId | null;
}

export interface BulkResult {
  started: BulkItem[];
  skipped: Array<BulkItem & { reason: string }>;
  /** Кадры, которым запуск назначил агента. */
  assigned: string[];
}

/**
 * assign — над столбцом «Кадр»: назначить агента кадрам без агента, ничего не запуская.
 * stage — над столбцом этапа: этот этап на всех кадрах, каждый кадр своим агентом.
 */
export type BulkTarget = { kind: "assign" } | { kind: "stage"; stageId: StageId };

function title(target: BulkTarget, tr: Translate): string {
  if (target.kind === "assign") return tr("bulk.assign");
  return tr("bulk.all", { stage: stageName(tr, target.stageId) });
}

function description(target: BulkTarget, tr: Translate): string {
  if (target.kind === "assign") return tr("bulk.assignLead");
  if (target.stageId === "characters") return tr("bulk.charactersLead");
  return tr("bulk.stageLead");
}

function endpoint(episodeId: string, target: BulkTarget): string {
  const episode = `/api/episodes/${encodeURIComponent(episodeId)}`;
  if (target.kind === "assign") return `${episode}/assign-agents`;
  return `${episode}/stages/${encodeURIComponent(target.stageId)}/run-all`;
}

/** Итог запуска по кадрам: кому назначен агент, что запущено, что пропущено и почему. */
export function BulkResultView({ result, withStage }: { result: BulkResult; withStage: boolean }) {
  const t = useT();
  return (
    <div className="space-y-1">
      {result.assigned.length ? (
        <p>{t("bulk.assigned", { n: result.assigned.length, ids: result.assigned.join(", ") })}</p>
      ) : null}
      <p className="font-medium text-stone-900">
        {t("bulk.started", { n: result.started.length })}
        {result.started.length
          ? ` (${result.started
              .map((item) => (withStage && item.stageId ? `${item.shotId} · ${stageName(t, item.stageId)}` : item.shotId))
              .join(", ")})`
          : ""}
      </p>
      {result.skipped.length ? (
        <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-4">
          {result.skipped.map((item) => (
            <li key={`${item.shotId}-${item.stageId ?? ""}`} className="break-words">
              {item.shotId}: {item.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Кнопка и меню запуска агентов на всех кадрах. Каждый кадр идёт своим агентом;
 * агента спрашивают только для кадров без агента, и он им назначается.
 * Кадры, где запускать нельзя или не нужно, пропускаются с причиной.
 */
export function BulkMenu({
  episodeId,
  target,
  shotCount,
  withoutAgent,
  onDone,
}: {
  episodeId: string;
  target: BulkTarget;
  shotCount: number;
  /** Сколько кадров без своего агента. */
  withoutAgent: number;
  onDone: () => void;
}) {
  const t = useT();
  const { anchor, open, menuRef, toggle, close } = useFloatingMenu(288);
  const [busy, setBusy] = useState(false);
  const [redo, setRedo] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState("");
  // Персонажей агент делает сам (agent), остальные этапы — переписать промпт (text).
  const mode = target.kind === "stage" && target.stageId === "characters" ? "agent" : "text";
  const agent = useAgentProviders(mode);
  const askAgent = withoutAgent > 0;

  async function run() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const data = await requestJson<BulkResult>(endpoint(episodeId, target), {
        method: "POST",
        body: {
          provider: askAgent ? (agent.selected ?? undefined) : undefined,
          model: askAgent ? (agent.model ?? undefined) : undefined,
          redo: target.kind === "stage" ? redo : undefined,
        },
        fallbackError: t("bulk.runFailed"),
      });
      setResult(data);
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 normal-case tracking-normal">
      <button
        type="button"
        onClick={(event) => toggle(event.currentTarget)}
        disabled={!shotCount}
        aria-expanded={open}
        className="rounded-md border border-teal-800/30 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-900 hover:bg-teal-100 disabled:opacity-50"
      >
        {target.kind === "assign" ? t("bulk.assignButton") : t("bulk.allButton")}
      </button>
      {anchor ? (
        <div
          ref={menuRef}
          style={{ top: anchor.top, bottom: anchor.bottom, left: anchor.left, maxHeight: anchor.maxHeight }}
          className="fixed z-30 w-72 space-y-3 overflow-y-auto rounded-xl border border-stone-300 bg-white p-3 text-left text-xs font-normal text-stone-700 shadow-lg"
        >
          <div>
            <div className="text-sm font-semibold text-stone-900">{title(target, t)}</div>
            <p className="mt-1 leading-snug">{description(target, t)}</p>
          </div>
          {!askAgent ? (
            <p className="text-stone-500">{t("bulk.allHave")}</p>
          ) : agent.providers ? (
            <div className="space-y-1">
              <p className="font-medium text-stone-900">
                {withoutAgent === shotCount
                  ? t("bulk.forAll")
                  : t("bulk.forSome", { n: withoutAgent })}
              </p>
              <ProviderSelect
                id={`bulk-provider-${target.kind === "stage" ? target.stageId : "assign"}`}
                providers={agent.providers}
                selected={agent.selected}
                mode={mode}
                disabled={busy}
                onChoose={agent.choose}
                model={agent.model}
                onChooseModel={agent.chooseModel}
              />
            </div>
          ) : (
            <p className="text-stone-500">{t("bulk.defaultAgent")}</p>
          )}
          {target.kind === "stage" ? (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={redo}
                disabled={busy}
                onChange={(event) => setRedo(event.target.checked)}
              />
              {t("bulk.redo")}
            </label>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={run}
              disabled={busy || (target.kind === "assign" && (!askAgent || !agent.selected))}
              className="h-8 flex-1 rounded-lg bg-teal-800 px-3 text-sm font-medium text-white hover:bg-teal-900 disabled:opacity-60"
            >
              {target.kind === "assign"
                ? busy
                  ? t("bulk.assigning")
                  : t("bulk.assignN", { n: withoutAgent })
                : busy
                  ? t("bulk.starting")
                  : t("bulk.runN", { n: shotCount })}
            </button>
            <button
              type="button"
              onClick={close}
              className="h-8 rounded-lg border border-stone-300 px-3 text-sm text-stone-700"
            >
              {t("common.close")}
            </button>
          </div>
          {error ? <p className="text-red-800">{error}</p> : null}
          {result && target.kind === "assign" ? (
            <p>
              {result.assigned.length
                ? t("bulk.assignedOnly", { ids: result.assigned.join(", ") })
                : t("bulk.nobody")}
            </p>
          ) : result ? (
            <BulkResultView result={result} withStage={false} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
