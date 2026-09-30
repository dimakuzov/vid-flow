import { NextResponse } from "next/server";
import { STAGES, type StageId } from "@/lib/series/constants";
import { submitAgentRequest } from "@/lib/series/agent-request";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ shotId: string; stage: string }> },
) {
  try {
    const { shotId, stage } = await context.params;
    if (!STAGES.includes(stage as StageId)) {
      return NextResponse.json({ error: "Неизвестный этап" }, { status: 400 });
    }

    const body = (await request.json()) as {
      message?: string;
      prompt?: string;
      refs?: string;
      workflow?: string;
    };
    const submitted = submitAgentRequest({
      shotId,
      stageId: stage as StageId,
      message: body.message || "",
      prompt: body.prompt || "",
      refsNote: body.refs || "",
      workflowNote: body.workflow || "",
    });

    const refsLine = submitted.refsChangedByUser
      ? "Референсы менялись вручную, агент оставит их и перепишет промпт."
      : "Референсы вручную не менялись, агент может собрать их заново вместе с промптом.";

    return NextResponse.json({
      message: `Запрос лежит в data/series/agent_inbox.md. ${refsLine}`,
      refsChangedByUser: submitted.refsChangedByUser,
      stage: getStageDetail(shotId, stage as StageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отправить агенту";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
