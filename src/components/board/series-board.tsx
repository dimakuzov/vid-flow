"use client";

import { useState } from "react";
import { STAGE_LABELS, STAGES } from "@/lib/series/constants";
import type { BootstrapPreview, SeriesSummary } from "@/lib/series/types";
import { BootstrapPanel } from "./bootstrap-panel";
import { StageCell } from "./stage-cell";

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
  const [pending, setPending] = useState(false);
  const [series, setSeries] = useState(initialSeries);
  const [seenSeries, setSeenSeries] = useState(initialSeries);
  const [newSeriesId, setNewSeriesId] = useState("");
  const [headerMessage, setHeaderMessage] = useState("");
  if (seenSeries !== initialSeries) {
    setSeenSeries(initialSeries);
    setSeries(initialSeries);
  }

  async function openSeries(id: string) {
    const episodeId = id.trim();
    if (!episodeId) return;
    setHeaderMessage("");
    try {
      const res = await fetch("/api/series/episode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось открыть серию");
      setNewSeriesId("");
      reload();
    } catch (error) {
      setHeaderMessage(error instanceof Error ? error.message : "Ошибка");
    }
  }

  function reload() {
    setPending(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    fetch("/api/series", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json()) as SeriesSummary & { error?: string };
        if (!res.ok) throw new Error(data.error || "Не удалось загрузить серию");
        if (!data.episodeId && series.episodeId) {
          setHeaderMessage("Серия на месте. Доска не успела прочитать папку, обнови ещё раз.");
          return;
        }
        setSeries(data);
        setHeaderMessage("");
      })
      .catch(() => {
        setHeaderMessage("Доска не обновилась. Серия не сброшена.");
      })
      .finally(() => {
        clearTimeout(timer);
        setPending(false);
      });
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <header className="relative overflow-hidden rounded-[28px] border border-teal-900/10 bg-[radial-gradient(circle_at_top_left,_rgba(15,118,110,0.18),_transparent_40%),linear-gradient(135deg,#f7f4ef_0%,#e7eef0_45%,#d9e7e4_100%)] px-6 py-8 sm:px-10">
        <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(28,57,56,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(28,57,56,0.08)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-teal-900/70">
              Frameboard
            </p>
            <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl leading-none tracking-tight text-stone-950 sm:text-5xl">
              {series.episodeId ? series.episodeTitle : "Серия не выбрана"}
            </h1>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-48 flex-col gap-1 text-xs font-medium text-stone-600">
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
            <label className="flex min-w-36 flex-col gap-1 text-xs font-medium text-stone-600">
              Новая
              <input
                value={newSeriesId}
                onChange={(event) => setNewSeriesId(event.target.value)}
                placeholder="e02"
                className="h-9 rounded-lg border border-stone-300 bg-white/90 px-2 font-mono text-sm text-stone-900"
              />
            </label>
            <button
              type="button"
              onClick={() => openSeries(newSeriesId)}
              className="h-9 rounded-lg border border-stone-300 bg-white/90 px-3 text-sm text-stone-800"
            >
              Добавить
            </button>
          </div>
        </div>
        {headerMessage ? (
          <p className="relative mt-3 text-sm text-stone-700">{headerMessage}</p>
        ) : null}
      </header>

      <section className="rounded-2xl border border-stone-300/70 bg-white/80 p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-[family-name:var(--font-display)] text-2xl text-stone-900">
            Таблица кадров
          </h2>
          <button
            type="button"
            onClick={reload}
            className="text-sm text-teal-800 underline-offset-4 hover:underline"
          >
            {pending ? "Обновление…" : "Обновить"}
          </button>
        </div>

        {loadError ? (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-red-300 bg-red-50 px-4 py-4 text-sm text-red-950">
            {loadError}
          </pre>
        ) : null}

        {series.shots.length === 0 && !loadError ? (
          <p className="rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-sm text-stone-600">
            Кадров пока нет. Отметь их галкой в импорте сценария ниже.
          </p>
        ) : null}

        {series.shots.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-separate border-spacing-2">
              <thead>
                <tr>
                  <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Кадр
                  </th>
                  {STAGES.map((stageId) => (
                    <th
                      key={stageId}
                      className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-500"
                    >
                      {STAGE_LABELS[stageId]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {series.shots.map((shot) => (
                  <tr key={shot.id}>
                    <td className="align-top">
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-800">
                          {shot.id}
                        </div>
                        <div className="mt-1 text-sm font-medium text-stone-900">
                          {shot.title}
                        </div>
                        <div className="mt-2 text-xs text-stone-500">
                          {shot.characters.join(", ") || "—"}
                          <br />
                          {shot.location || "локация не задана"}
                        </div>
                      </div>
                    </td>
                    {STAGES.map((stageId) => (
                      <td key={stageId} className="align-top">
                        <StageCell
                          shotId={shot.id}
                          stageId={stageId}
                          stage={shot.stages[stageId]}
                          onChanged={reload}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <BootstrapPanel
        key={`${initialSeries.episodeId ?? ""}::${initialRawScenario}::${initialScenario}`}
        initialEpisodeId={series.episodeId ?? initialSeries.episodeId}
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
        onImported={reload}
      />
    </div>
  );
}
