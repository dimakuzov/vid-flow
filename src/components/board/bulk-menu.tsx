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

/**
 * next — над столбцом «Кадр»: каждому кадру агент на его следующий этап.
 * shot — на одном кадре: агент на его следующий этап.
 * stage — над столбцом этапа: этот этап на всех кадрах.
 */
export type BulkTarget = { kind: "next" } | { kind: "shot"; shotId: string } | { kind: "stage"; stageId: StageId };

function title(target: BulkTarget): string {
  if (target.kind === "next") return "Агенты по всем кадрам";
  if (target.kind === "shot") return `Агент на кадре ${target.shotId}`;
  return `${STAGE_LABELS[target.stageId]}: все кадры`;
}

function description(target: BulkTarget): string {
  if (target.kind === "next") {
    return "Каждому кадру — агент на его следующий этап. Кадры, где агент уже работает или этап уже пройден, не трогаются.";
  }
  if (target.kind === "shot") {
    return "Агент на следующий этап этого кадра. Выберите агента и модель под сложность кадра.";
  }
  if (target.stageId === "characters") {
    return "На каждом кадре агент сам делает персонажей в ComfyUI. Нужен Claude Code или агент в чате.";
  }
  return "На каждом кадре агент готовит промпт этого этапа, затем доска ставит прогон в ComfyUI. Пройденные этапы не переделываются.";
}

function endpoint(episodeId: string, target: BulkTarget): string {
  const episode = `/api/episodes/${encodeURIComponent(episodeId)}`;
  if (target.kind === "next") return `${episode}/next-stage`;
  if (target.kind === "shot") return `${episode}/shots/${encodeURIComponent(target.shotId)}/next-stage`;
  return `${episode}/stages/${encodeURIComponent(target.stageId)}/run-all`;
}

function buttonText(target: BulkTarget): string {
  if (target.kind === "next") return "▶ Агенты по кадрам";
  if (target.kind === "shot") return "▶ Агент";
  return "▶ Все кадры";
}

/**
 * Кнопка и меню запуска агентов: выбор агента и модели, запуск, итог по кадрам.
 * Кадры, где запускать нельзя или не нужно, пропускаются с причиной.
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
  const [redo, setRedo] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState("");
  // Персонажей агент делает сам (agent), остальные этапы — переписать промпт (text).
  const mode = target.kind === "stage" && target.stageId === "characters" ? "agent" : "text";
  const agent = useAgentProviders(mode);

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
      const data = await requestJson<BulkResult>(endpoint(episodeId, target), {
        method: "POST",
        body: {
          provider: agent.selected ?? undefined,
          model: agent.model ?? undefined,
          redo: target.kind === "stage" ? redo : undefined,
        },
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

  const runLabel = target.kind === "shot" ? "Запустить агента" : `Запустить на ${shotCount} кадрах`;

  return (
    <div className="mt-1 normal-case tracking-normal">
      <button
        type="button"
        onClick={(event) => toggle(event.currentTarget)}
        disabled={!shotCount}
        aria-expanded={open}
        className="rounded-md border border-teal-800/30 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-900 hover:bg-teal-100 disabled:opacity-50"
      >
        {buttonText(target)}
      </button>
      {anchor ? (
        <div
          ref={menuRef}
          style={{ top: anchor.top, left: anchor.left }}
          className="fixed z-30 max-h-[calc(100vh-2rem)] w-72 space-y-3 overflow-y-auto rounded-xl border border-stone-300 bg-white p-3 text-left text-xs font-normal text-stone-700 shadow-lg"
        >
          <div>
            <div className="text-sm font-semibold text-stone-900">{title(target)}</div>
            <p className="mt-1 leading-snug">{description(target)}</p>
          </div>
          {agent.providers ? (
            <ProviderSelect
              id={`bulk-provider-${target.kind}-${target.kind === "stage" ? target.stageId : target.kind === "shot" ? target.shotId : "all"}`}
              providers={agent.providers}
              selected={agent.selected}
              mode={mode}
              disabled={busy}
              onChoose={agent.choose}
              model={agent.model}
              onChooseModel={agent.chooseModel}
            />
          ) : (
            <p className="text-stone-500">Агент — по умолчанию доски.</p>
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
              Переделать и там, где этап уже пройден (утверждён или есть результат)
            </label>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="h-8 flex-1 rounded-lg bg-teal-800 px-3 text-sm font-medium text-white hover:bg-teal-900 disabled:opacity-60"
            >
              {busy ? "Запуск…" : runLabel}
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
                      .map((item) =>
                        target.kind !== "stage" && item.stageId
                          ? `${item.shotId} · ${STAGE_LABELS[item.stageId]}`
                          : item.shotId,
                      )
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
