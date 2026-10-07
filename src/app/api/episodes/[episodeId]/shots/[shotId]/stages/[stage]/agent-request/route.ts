import { NextResponse } from "next/server";
import type { AgentMode } from "@/lib/contracts/agent-request";
import { submitAgentRequest } from "@/lib/series/agent-request";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { getStageDetail } from "@/lib/series/scanner";

export const runtime = "nodejs";

function submittedMessage(mode: AgentMode | undefined): string {
  if (mode === "text") return "Отдано агенту. Он перепишет промпт, затем доска сама поставит прогон в Comfy.";
  if (mode === "agent") return "Отдано агенту. Он сделает этап сам, файлы появятся в output/.";
  return "Сохранено. Задача в llm_task.md этапа: агент в чате берёт её из agent_inbox.md и ставит done.";
}

export async function POST(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const body = (await request.json()) as {
      message?: string;
      prompt?: string;
      refs?: string;
      /** Заметка workflow.md. */
      workflow?: string;
      /** id манифеста графа (docs/contracts/graph-binding.md). */
      runWorkflow?: unknown;
      /** Старое имя выбора графа (i2v / flf). */
      videoWorkflow?: unknown;
      /** manual | ollama | claude. Нет — FRAMEBOARD_AGENT_PROVIDER. */
      provider?: unknown;
      /** Модель провайдера (claude-sonnet-5-5, модель Ollama). Нет — по умолчанию. */
      model?: unknown;
    };
    const submitted = submitAgentRequest({
      episodeId,
      shotId,
      stageId,
      message: body.message || "",
      prompt: body.prompt || "",
      refsNote: body.refs || "",
      workflowNote: body.workflow || "",
      workflow:
        typeof body.runWorkflow === "string"
          ? body.runWorkflow
          : typeof body.videoWorkflow === "string"
            ? body.videoWorkflow
            : undefined,
      provider: typeof body.provider === "string" ? body.provider : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    });

    return NextResponse.json({
      message: submittedMessage(submitted.mode),
      refsChangedByUser: submitted.refsChangedByUser,
      stage: getStageDetail(episodeId, shotId, stageId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отправить агенту";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
