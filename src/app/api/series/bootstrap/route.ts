import { NextResponse } from "next/server";
import { applyBootstrap, parseScenario, readScenarioText } from "@/lib/series/bootstrap";

export const runtime = "nodejs";

export async function GET() {
  try {
    const scenario = readScenarioText();
    const preview = parseScenario(scenario || "# Серия\n");
    return NextResponse.json({ scenario, preview });
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
      const scenario = body.scenario ?? readScenarioText();
      return NextResponse.json({ preview: parseScenario(scenario) });
    }

    const result = applyBootstrap({
      scenario: body.scenario,
      shotIds: body.shotIds,
      overwriteDocs: body.overwriteDocs,
      episodeId: body.episodeId,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка импорта";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
