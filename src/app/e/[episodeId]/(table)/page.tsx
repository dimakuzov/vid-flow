import { notFound } from "next/navigation";
import { SeriesBoard } from "@/components/board/series-board";
import { listEpisodeIds, normalizeEpisodeId } from "@/lib/series/paths";
import { loadBoard } from "../../board-data";

export const dynamic = "force-dynamic";

function episodeFromParam(raw: string): string | null {
  try {
    return normalizeEpisodeId(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

export default async function EpisodePage(props: PageProps<"/e/[episodeId]">) {
  const { episodeId: raw } = await props.params;
  const episodeId = episodeFromParam(raw);
  if (!episodeId || !listEpisodeIds().includes(episodeId)) notFound();
  const board = loadBoard(episodeId);
  return (
    <SeriesBoard
      key={episodeId}
      loadError={board.loadError}
      initialSeries={board.series}
      initialScenario={board.scenario}
      initialRawScenario={board.rawScenario}
      initialPreview={board.preview}
    />
  );
}
