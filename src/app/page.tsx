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

function errorText(error: unknown): string {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
  return String(error);
}

export default function HomePage() {
  const loadErrors: string[] = [];
  let series = emptySeries();
  try {
    series = scanSeries();
  } catch (error) {
    console.error(error);
    loadErrors.push(errorText(error));
    series = emptySeries();
  }
  let scenario = "";
  let rawScenario = "";
  try {
    scenario = series.episodeId ? readScenarioText(series.episodeId) : "";
    rawScenario = series.episodeId ? readRawScenarioText(series.episodeId) : "";
  } catch (error) {
    console.error(error);
    loadErrors.push(errorText(error));
    scenario = "";
    rawScenario = "";
  }
  let preview: BootstrapPreview = { seriesTitle: series.episodeTitle || "Серия", shots: [] };
  try {
    preview = parseScenario(scenario.trim() ? scenario : "# Эпизод\n");
  } catch (error) {
    console.error(error);
    loadErrors.push(errorText(error));
    preview = { seriesTitle: series.episodeTitle || "Серия", shots: [] };
  }

  return (
    <SeriesBoard
      loadError={loadErrors.join("\n\n")}
      initialSeries={series}
      initialScenario={scenario}
      initialRawScenario={rawScenario}
      initialPreview={preview}
    />
  );
}
