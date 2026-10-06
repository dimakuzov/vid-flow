import { NextResponse } from "next/server";
import { readAgentDispatch, submitAgentRequest } from "@/lib/series/agent-request";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const body = (await request.json()) as {
      message?: string;
      prompt?: string;
      refs?: string;
      workflow?: string;
      videoWorkflow?: unknown;
    };
    const submitted = submitAgentRequest({
      episodeId,
      shotId,
      stageId,
      message: body.message || "",
      prompt: body.prompt || "",
      refsNote: body.refs || "",
      workflowNote: body.workflow || "",
      videoWorkflow: body.videoWorkflow === "flf" ? "flf" : "i2v",
    });
    const dispatch = readAgentDispatch(episodeId, shotId, stageId);

    return NextResponse.json({
      message:
        dispatch?.state === "agent"
          ? "Сохранено и отдано агенту. Он сам поставит прогон в Comfy, файлы появятся в output/."
          : "Сохранено и отдано агенту. Когда он допишет промпт, доска сама поставит прогон в Comfy.",
      refsChangedByUser: submitted.refsChangedByUser,
      stage: getStageDetail(episodeId, shotId, stageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отправить агенту";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
