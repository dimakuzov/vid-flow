"use client";

import { useParams } from "next/navigation";
import { readBoardSnapshot } from "@/components/board/board-snapshot";
import { SeriesBoard } from "@/components/board/series-board";
import { useT } from "@/components/language";

/** Страница таблицы ещё собирается на сервере: показываем прошлую таблицу и плашку «обновляется». */
export default function BoardLoading() {
  const t = useT();
  const params = useParams<{ episodeId: string }>();
  const episodeId = decodeURIComponent(params.episodeId ?? "");
  const snapshot = readBoardSnapshot(episodeId);
  if (!snapshot) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {t("board.updating")}
        </p>
      </div>
    );
  }
  return (
    <SeriesBoard
      key={episodeId}
      updating
      initialSeries={snapshot.series}
      initialScenario={snapshot.scenario}
      initialRawScenario={snapshot.rawScenario}
      initialPreview={snapshot.preview}
    />
  );
}
