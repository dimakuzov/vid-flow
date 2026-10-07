"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { episodePagePath, errorText, requestJson } from "@/components/stage/api";
import { STAGE_LABELS, STAGES } from "@/lib/series/constants";
import type { BootstrapPreview, SeriesSummary, ShotSummary } from "@/lib/series/types";
import { BootstrapPanel } from "./bootstrap-panel";
import { BulkMenu } from "./bulk-menu";
import { NewEpisodeDialog } from "./new-episode-dialog";
import { StageCell } from "./stage-cell";

function ShotHeader({
  shot,
  episodeId,
  onChanged,
}: {
  shot: ShotSummary;
  episodeId: string;
  onChanged: () => void;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-800">{shot.id}</div>
      <div className="mt-1 text-sm font-medium text-stone-900">{shot.title}</div>
      <div className="mt-2 text-xs text-stone-500">
        {shot.characters.join(", ") || "—"}
        <br />
        {shot.location || "локация не задана"}
      </div>
      <BulkMenu episodeId={episodeId} target={{ kind: "shot", shotId: shot.id }} shotCount={1} onDone={onChanged} />
    </div>
  );
}

export function SeriesBoard({
  loadError = "",
  initialSeries,
  initialScenario,
  initialRawScenario,
  initialPreview,
}: {
  loadError?: string;
  initialSeries: SeriesSummary;
  initialScenario: string;
  initialRawScenario: string;
  initialPreview: BootstrapPreview;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [series, setSeries] = useState(initialSeries);
  const [seenSeries, setSeenSeries] = useState(initialSeries);
  const [newEpisodeOpen, setNewEpisodeOpen] = useState(false);
  const [headerMessage, setHeaderMessage] = useState("");
  const reloadInFlight = useRef(false);
  // Эпизод страницы задаётся URL (/e/{episodeId}); на смену эпизода страница монтируется заново.
  const episodeId = initialSeries.episodeId;
  if (seenSeries !== initialSeries) {
    setSeenSeries(initialSeries);
    setSeries(initialSeries);
  }

  /** Перейти на эпизод. POST только запоминает выбор по умолчанию (и создаёт новый эпизод). */
  async function openSeries(id: string) {
    const nextId = id.trim();
    if (!nextId) return;
    setHeaderMessage("");
    try {
      const data = await requestJson<{ episodeId: string }>("/api/series/episode", {
        method: "POST",
        body: { episodeId: nextId },
        fallbackError: "Не удалось открыть серию",
      });
      router.push(episodePagePath(data.episodeId));
    } catch (error) {
      setHeaderMessage(errorText(error));
    }
  }

  const reload = useCallback(
    (options?: { quiet?: boolean }) => {
      if (!episodeId) return;
      const quiet = options?.quiet ?? false;
      if (quiet && reloadInFlight.current) return;
      reloadInFlight.current = true;
      if (!quiet) setPending(true);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      fetch(`/api/episodes/${encodeURIComponent(episodeId)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (res) => {
          const data = (await res.json()) as SeriesSummary & { error?: string };
          if (!res.ok) throw new Error(data.error || "Не удалось загрузить серию");
          setSeries(data);
          if (!quiet) setHeaderMessage("");
        })
        .catch(() => {
          if (!quiet) setHeaderMessage("Доска не обновилась. Серия не сброшена.");
        })
        .finally(() => {
          clearTimeout(timer);
          reloadInFlight.current = false;
          if (!quiet) setPending(false);
        });
    },
    [episodeId],
  );

  const onChanged = useCallback(() => reload(), [reload]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      reload({ quiet: true });
    }, 4000);
    return () => clearInterval(timer);
  }, [reload]);

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <header className="relative overflow-hidden rounded-[28px] border border-teal-900/10 bg-[radial-gradient(circle_at_top_left,_rgba(15,118,110,0.18),_transparent_40%),linear-gradient(135deg,#f7f4ef_0%,#e7eef0_45%,#d9e7e4_100%)] px-5 py-8 sm:px-10">
        <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(28,57,56,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(28,57,56,0.08)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-teal-900/70">
              Frameboard
            </p>
            <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl leading-none tracking-tight break-words text-stone-950 sm:text-5xl">
              {series.episodeId ? series.episodeTitle : "Серия не выбрана"}
            </h1>
          </div>
          <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
            <label className="flex w-full min-w-0 flex-col gap-1 text-xs font-medium text-stone-600 sm:w-auto sm:min-w-48">
              Серия
              <select
                value={series.episodeId ?? ""}
                onChange={(event) => openSeries(event.target.value)}
                className="h-9 rounded-lg border border-stone-300 bg-white/90 px-2 text-sm text-stone-900"
              >
                <option value="" disabled>
                  Выбери серию
                </option>
                {series.episodes.map((episode) => (
                  <option key={episode.id} value={episode.id}>
                    {episode.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setNewEpisodeOpen(true)}
              className="h-9 rounded-lg border border-stone-300 bg-white/90 px-3 text-sm text-stone-800"
            >
              Добавить
            </button>
            <NewEpisodeDialog
              open={newEpisodeOpen}
              onOpenChange={setNewEpisodeOpen}
              onCreated={(id) => router.push(episodePagePath(id))}
            />
          </div>
        </div>
        {headerMessage ? (
          <p className="relative mt-3 text-sm text-stone-700">{headerMessage}</p>
        ) : null}
      </header>

      <section className="min-w-0 rounded-2xl border border-stone-300/70 bg-white/80 p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-[family-name:var(--font-display)] text-2xl text-stone-900">
            Таблица кадров
          </h2>
          {episodeId ? (
            <button
              type="button"
              onClick={() => reload()}
              className="text-sm text-teal-800 underline-offset-4 hover:underline"
            >
              {pending ? "Обновление…" : "Обновить"}
            </button>
          ) : null}
        </div>

        {series.formatRequest && series.formatRequest.provider !== "manual" && series.formatRequest.status !== "done" ? (
          <p
            className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
              series.formatRequest.status === "error"
                ? "border-red-300 bg-red-50 text-red-950"
                : "border-sky-300 bg-sky-50 text-sky-950"
            }`}
          >
            {series.formatRequest.status === "error"
              ? `Разметка сценария не удалась: ${series.formatRequest.error ?? "ошибка"}`
              : `Модель размечает сценарий (${series.formatRequest.model ?? series.formatRequest.provider}). Таблица появится сама.`}
          </p>
        ) : null}

        {loadError ? (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-red-300 bg-red-50 px-4 py-4 text-sm text-red-950">
            {loadError}
          </pre>
        ) : null}

        {series.shots.length === 0 && !loadError ? (
          <p className="rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-sm text-stone-600">
            {episodeId
              ? "Кадров пока нет. Отметь их галкой в импорте сценария ниже."
              : "Эпизодов пока нет. Нажми «Добавить» в шапке: выбери сценарий и модель, таблица соберётся сама."}
          </p>
        ) : null}

        {series.shots.length > 0 && episodeId ? (
          <>
            {/* Телефон: кадр — карточка, этапы списком. Кнопки «для всех кадров» — строкой сверху. */}
            <div className="mb-4 flex flex-wrap gap-x-3 gap-y-1 md:hidden">
              <BulkMenu episodeId={episodeId} target={{ kind: "next" }} shotCount={series.shots.length} onDone={onChanged} />
              {STAGES.map((stageId) => (
                <div key={stageId} className="flex items-center gap-1 text-[11px] text-stone-500">
                  <span>{STAGE_LABELS[stageId]}</span>
                  <BulkMenu episodeId={episodeId} target={{ kind: "stage", stageId }} shotCount={series.shots.length} onDone={onChanged} />
                </div>
              ))}
            </div>
            <div className="space-y-6 md:hidden">
              {series.shots.map((shot) => (
                <div key={shot.id} className="space-y-2">
                  <ShotHeader shot={shot} episodeId={episodeId} onChanged={onChanged} />
                  <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                    {STAGES.map((stageId) => (
                      <div key={stageId} className="min-w-0">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                          {STAGE_LABELS[stageId]}
                        </div>
                        <StageCell
                          episodeId={episodeId}
                          shotId={shot.id}
                          stageId={stageId}
                          stage={shot.stages[stageId]}
                          onChanged={onChanged}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[960px] border-separate border-spacing-2">
                <thead>
                  <tr>
                    <th className="px-2 py-2 text-left align-top text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                      Кадр
                      <BulkMenu episodeId={episodeId} target={{ kind: "next" }} shotCount={series.shots.length} onDone={onChanged} />
                    </th>
                    {STAGES.map((stageId) => (
                      <th
                        key={stageId}
                        className="px-2 py-2 text-left align-top text-xs font-semibold uppercase tracking-[0.18em] text-stone-500"
                      >
                        {STAGE_LABELS[stageId]}
                        <BulkMenu episodeId={episodeId} target={{ kind: "stage", stageId }} shotCount={series.shots.length} onDone={onChanged} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {series.shots.map((shot) => (
                    <tr key={shot.id}>
                      <td className="align-top">
                        <ShotHeader shot={shot} episodeId={episodeId} onChanged={onChanged} />
                      </td>
                      {STAGES.map((stageId) => (
                        <td key={stageId} className="align-top">
                          <StageCell
                            episodeId={episodeId}
                            shotId={shot.id}
                            stageId={stageId}
                            stage={shot.stages[stageId]}
                            onChanged={onChanged}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      {episodeId ? (
        <BootstrapPanel
          key={`${episodeId}::${initialRawScenario}::${initialScenario}`}
          initialEpisodeId={episodeId}
          tableShots={series.shots.map((shot) => ({
            id: shot.id,
            title: shot.title,
            characters: shot.characters,
            location: shot.location,
          }))}
          initialScenario={initialScenario}
          initialRawScenario={initialRawScenario}
          initialPreview={initialPreview}
          formatRequestStatus={series.formatRequestStatus}
          onImported={onChanged}
        />
      ) : null}
    </div>
  );
}
