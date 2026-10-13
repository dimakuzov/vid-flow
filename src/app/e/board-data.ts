import { parseScenario, readRawScenarioText, readScenarioText } from "@/lib/series/bootstrap";
import { scanSeries } from "@/lib/series/scanner";
import type { BootstrapPreview, SeriesSummary } from "@/lib/series/types";

export interface BoardData {
  loadError: string;
  series: SeriesSummary;
  scenario: string;
  rawScenario: string;
  preview: BootstrapPreview;
}

export function emptySeries(): SeriesSummary {
  return {
    id: "series",
    title: "Сериал",
    description: "",
    root: "",
    episodeId: null,
    episodeTitle: "",
    episodes: [],
    shots: [],
    hiddenShots: [],
    scenarioExists: false,
    hasRawScenario: false,
    formatRequestStatus: null,
    formatRequest: null,
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
  return String(error);
}

/** Данные таблицы эпизода. Ошибки чтения не роняют страницу: показываются над таблицей. */
export function loadBoard(episodeId: string | null): BoardData {
  const loadErrors: string[] = [];
  let series = emptySeries();
  try {
    series = episodeId ? scanSeries(episodeId) : scanSeries();
  } catch (error) {
    console.error(error);
    loadErrors.push(errorText(error));
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
  }
  return { loadError: loadErrors.join("\n\n"), series, scenario, rawScenario, preview };
}
