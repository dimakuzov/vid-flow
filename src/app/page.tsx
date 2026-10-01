import { SeriesBoard } from "@/components/board/series-board";
import { readRawScenarioText, readScenarioText, parseScenario } from "@/lib/series/bootstrap";
import { scanSeries } from "@/lib/series/scanner";
import type { BootstrapPreview, SeriesSummary } from "@/lib/series/types";

export const dynamic = "force-dynamic";

function emptySeries(): SeriesSummary {
  return {
    id: "series",
    title: "Сериал",
    description: "",
    root: "",
    episodeId: null,
    episodeTitle: "",
    episodes: [],
    shots: [],
    scenarioExists: false,
    hasRawScenario: false,
    formatRequestStatus: null,
  };
}

export default function HomePage() {
  let series = emptySeries();
  try {
    series = scanSeries();
  } catch {
    series = emptySeries();
  }
  let scenario = "";
  let rawScenario = "";
  try {
    scenario = series.episodeId ? readScenarioText() : "";
    rawScenario = series.episodeId ? readRawScenarioText() : "";
  } catch {
    scenario = "";
    rawScenario = "";
  }
  let preview: BootstrapPreview = { seriesTitle: series.episodeTitle || "Серия", shots: [] };
  try {
    preview = parseScenario(scenario.trim() ? scenario : "# Эпизод\n");
  } catch {
    preview = { seriesTitle: series.episodeTitle || "Серия", shots: [] };
  }

  return (
    <SeriesBoard
      initialSeries={series}
      initialScenario={scenario}
      initialRawScenario={rawScenario}
      initialPreview={preview}
    />
  );
}
