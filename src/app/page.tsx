import { SeriesBoard } from "@/components/board/series-board";
import { readScenarioText, parseScenario } from "@/lib/series/bootstrap";
import { scanSeries } from "@/lib/series/scanner";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const series = scanSeries();
  const scenario = readScenarioText();
  const preview = parseScenario(scenario || "# Серия\n");

  return (
    <SeriesBoard
      initialSeries={series}
      initialScenario={scenario}
      initialPreview={preview}
    />
  );
}
