import { redirect } from "next/navigation";
import { SeriesBoard } from "@/components/board/series-board";
import { episodePagePath } from "@/components/stage/api";
import { listEpisodeIds } from "@/lib/series/paths";
import { scanSeries } from "@/lib/series/scanner";
import { loadBoard } from "./e/board-data";

export const dynamic = "force-dynamic";

function defaultEpisodeId(): string | null {
  try {
    return scanSeries().episodeId ?? listEpisodeIds()[0] ?? null;
  } catch {
    return listEpisodeIds()[0] ?? null;
  }
}

/** `/` — открытый эпизод (`current_episode.txt`). Эпизодов нет — пустая доска, чтобы создать первый. */
export default function HomePage() {
  const episodeId = defaultEpisodeId();
  if (episodeId) redirect(episodePagePath(episodeId));
  const board = loadBoard(null);
  return (
    <SeriesBoard
      loadError={board.loadError}
      initialSeries={board.series}
      initialScenario={board.scenario}
      initialRawScenario={board.rawScenario}
      initialPreview={board.preview}
    />
  );
}
