import { NextResponse } from "next/server";
import { STAGES, type StageId } from "@/lib/series/constants";
import { readAgentDispatch, submitAgentRequest } from "@/lib/series/agent-request";
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
      videoWorkflow?: unknown;
    };
    const submitted = submitAgentRequest({
      shotId,
      stageId: stage as StageId,
      message: body.message || "",
      prompt: body.prompt || "",
      refsNote: body.refs || "",
      workflowNote: body.workflow || "",
      videoWorkflow: body.videoWorkflow === "flf" ? "flf" : "i2v",
    });
    const dispatch = readAgentDispatch(shotId, stage as StageId);

    return NextResponse.json({
      message:
        dispatch?.state === "agent"
          ? "Сохранено и отдано агенту. Он сам поставит прогон в Comfy, файлы появятся в output/."
          : "Сохранено и отдано агенту. Когда он допишет промпт, доска сама поставит прогон в Comfy.",
      refsChangedByUser: submitted.refsChangedByUser,
      stage: getStageDetail(shotId, stage as StageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отправить агенту";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
