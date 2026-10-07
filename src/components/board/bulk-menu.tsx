"use client";

import { useEffect, useRef, useState } from "react";
import { ProviderSelect, useAgentProviders } from "@/components/stage/agent-provider";
import { errorText, requestJson } from "@/components/stage/api";
import { STAGE_LABELS, type StageId } from "@/lib/series/constants";

interface BulkItem {
  shotId: string;
  stageId: StageId | null;
}

interface BulkResult {
  started: BulkItem[];
  skipped: Array<BulkItem & { reason: string }>;
}

/** «next» — над столбцом «Кадр»: каждому кадру агент на его следующий этап. Иначе — этап столбца на всех кадрах. */
export type BulkTarget = StageId | "next";

function title(target: BulkTarget): string {
  return target === "next" ? "Агенты по всем кадрам" : `${STAGE_LABELS[target]}: все кадры`;
}

function description(target: BulkTarget): string {
  if (target === "next") {
    return "Каждому кадру — агент на его следующий неутверждённый этап. Агент готовит промпт, доска запускает этап. Утверждаете вы.";
  }
  if (target === "characters") {
    return "На каждом кадре агент сам делает персонажей в ComfyUI. Нужен Claude или агент в чате.";
  }
  return "На каждом кадре агент готовит промпт этого этапа, затем доска ставит прогон в ComfyUI. Задания идут по очереди.";
}

/**
 * Кнопка над столбцом таблицы и её меню: выбор агента, запуск, итог по кадрам.
 * Кадры, где этап запустить нельзя, пропускаются с причиной.
 */
export function BulkMenu({
  episodeId,
  target,
  shotCount,
  onDone,
}: {
  episodeId: string;
  target: BulkTarget;
  shotCount: number;
  onDone: () => void;
}) {
  // Меню — fixed поверх страницы: внутри таблицы с прокруткой его обрезало бы снизу.
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const open = anchor !== null;
  const menuRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [includeApproved, setIncludeApproved] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState("");
  // Персонажей агент делает сам (agent), остальные этапы — переписать промпт (text).
  const mode = target === "characters" ? "agent" : "text";
  const { providers, selected, choose } = useAgentProviders(mode);

  useEffect(() => {
    if (!open) return;
    const close = () => setAnchor(null);
    // Прокрутка страницы или таблицы уводит кнопку — меню закрывается. Прокрутка внутри меню — нет.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function toggle(button: HTMLButtonElement) {
    if (open) {
      setAnchor(null);
      return;
    }
    const rect = button.getBoundingClientRect();
    const width = 288;
    setAnchor({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) });
  }

  async function run() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const url =
        target === "next"
          ? `/api/episodes/${encodeURIComponent(episodeId)}/next-stage`
          : `/api/episodes/${encodeURIComponent(episodeId)}/stages/${encodeURIComponent(target)}/run-all`;
      const data = await requestJson<BulkResult>(url, {
        method: "POST",
        body: { provider: selected ?? undefined, includeApproved: target === "next" ? undefined : includeApproved },
        fallbackError: "Не удалось запустить",
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
        {target === "next" ? "▶ Агенты по кадрам" : "▶ Все кадры"}
      </button>
      {open ? (
        <div
          ref={menuRef}
          style={{ top: anchor.top, left: anchor.left }}
          className="fixed z-30 max-h-[calc(100vh-2rem)] w-72 space-y-3 overflow-y-auto rounded-xl border border-stone-300 bg-white p-3 text-left text-xs font-normal text-stone-700 shadow-lg"
        >
          <div>
            <div className="text-sm font-semibold text-stone-900">{title(target)}</div>
            <p className="mt-1 leading-snug">{description(target)}</p>
          </div>
          {providers ? (
            <ProviderSelect
              id={`bulk-provider-${target}`}
              providers={providers}
              selected={selected}
              mode={mode}
              disabled={busy}
              onChoose={choose}
            />
          ) : (
            <p className="text-stone-500">Агент — по умолчанию доски.</p>
          )}
          {target !== "next" ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeApproved}
                disabled={busy}
                onChange={(event) => setIncludeApproved(event.target.checked)}
              />
              И там, где этап уже утверждён
            </label>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="h-8 flex-1 rounded-lg bg-teal-800 px-3 text-sm font-medium text-white hover:bg-teal-900 disabled:opacity-60"
            >
              {busy ? "Запуск…" : `Запустить на ${shotCount} кадрах`}
            </button>
            <button
              type="button"
              onClick={() => setAnchor(null)}
              className="h-8 rounded-lg border border-stone-300 px-3 text-sm text-stone-700"
            >
              Закрыть
            </button>
          </div>
          {error ? <p className="text-red-800">{error}</p> : null}
          {result ? (
            <div className="space-y-1">
              <p className="font-medium text-stone-900">
                Запущено: {result.started.length}
                {result.started.length
                  ? ` (${result.started
                      .map((item) => (target === "next" && item.stageId ? `${item.shotId} · ${STAGE_LABELS[item.stageId]}` : item.shotId))
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
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
