import { NextResponse } from "next/server";
import { applyBootstrap, parseScenario, readScenarioText } from "@/lib/series/bootstrap";
import { normalizeEpisodeId, requireCurrentEpisodeId } from "@/lib/series/paths";

export const runtime = "nodejs";

/** Эпизод из запроса; без него — открытый (`current_episode.txt`). */
function episodeFrom(value: string | null | undefined): string {
  return value?.trim() ? normalizeEpisodeId(value) : requireCurrentEpisodeId();
}

export async function GET(request: Request) {
  try {
    const episodeId = episodeFrom(new URL(request.url).searchParams.get("episodeId"));
    const scenario = readScenarioText(episodeId);
    const preview = parseScenario(scenario || "# Серия\n");
    return NextResponse.json({ episodeId, scenario, preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка чтения сценария";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      scenario?: string;
      shotIds?: string[];
      overwriteDocs?: boolean;
      previewOnly?: boolean;
      episodeId?: string;
    };

    if (body.previewOnly) {
      const scenario = body.scenario ?? readScenarioText(episodeFrom(body.episodeId));
      return NextResponse.json({ preview: parseScenario(scenario) });
    }

    const result = applyBootstrap({
      scenario: body.scenario,
      shotIds: body.shotIds,
      overwriteDocs: body.overwriteDocs,
      episodeId: episodeFrom(body.episodeId),
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка импорта";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
