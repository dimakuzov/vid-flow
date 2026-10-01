import { SeriesBoard } from "@/components/board/series-board";
import { readRawScenarioText, readScenarioText, parseScenario } from "@/lib/series/bootstrap";
import { scanSeries } from "@/lib/series/scanner";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const series = scanSeries();
  const scenario = series.episodeId ? readScenarioText() : "";
  const rawScenario = series.episodeId ? readRawScenarioText() : "";
  const preview = parseScenario(scenario.trim() ? scenario : "# Эпизод\n");

  return (
    <SeriesBoard
      initialSeries={series}
      initialScenario={scenario}
      initialRawScenario={rawScenario}
      initialPreview={preview}
    />
  );
}
