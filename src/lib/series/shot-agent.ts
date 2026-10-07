import fs from "fs";
import path from "path";
import type { AgentProviderId } from "../contracts/agent-request";
import { isProviderId } from "../agent/config";
import { readAgentRequest } from "../agent/files";
import { getAgentProvider } from "../agent/providers";
import { isAgentRunLive } from "../agent/runner";
import { STAGES, type StageId } from "./constants";
import { writeText } from "./media";
import { assertSafeSegment, shotDir } from "./paths";
import { readStageStateFile } from "./stage-state";

/*
 * Агент кадра: провайдер и модель, которыми доска запускает этапы этого кадра
 * («▶ Агент» на кадре, «Агенты по кадрам», «▶ Все кадры», «Отправить агенту»).
 * Файл `shots/{shotId}/agent.json`, пишет только доска.
 */

const AGENT_FILE = "agent.json";

export interface ShotAgent {
  provider: AgentProviderId;
  /** null — модель провайдера по умолчанию. */
  model: string | null;
  updatedAt: string;
}

/** Что агент кадра делает сейчас. running — провайдер работает, queued — запрос ждёт места или агента в чате. */
export interface ShotAgentActivity {
  stageId: StageId;
  status: "running" | "queued";
  since: string;
  /** Кем идёт запрос (может быть не агент кадра: другой выбор на один раз). */
  provider: AgentProviderId;
}

function agentPath(episodeId: string, shotId: string): string {
  return path.join(shotDir(episodeId, assertSafeSegment(shotId, "shot")), AGENT_FILE);
}

export function readShotAgent(episodeId: string, shotId: string): ShotAgent | null {
  try {
    const data = JSON.parse(fs.readFileSync(agentPath(episodeId, shotId), "utf8")) as Partial<ShotAgent>;
    if (!isProviderId(data.provider)) return null;
    return {
      provider: data.provider,
      model: typeof data.model === "string" && data.model ? data.model : null,
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
    };
  } catch {
    return null;
  }
}

/** Проверяет провайдера и модель так же, как запрос агенту. Ошибка — текст для пользователя. */
export function checkShotAgent(provider: string, model?: string | null): { provider: AgentProviderId; model: string | null } {
  const id = provider.trim();
  if (!isProviderId(id)) throw new Error(`Неизвестный провайдер агента «${id}»`);
  const chosen = model?.trim() || null;
  const configError = getAgentProvider(id).configError?.(chosen ?? undefined);
  if (configError) throw new Error(configError);
  return { provider: id, model: chosen };
}

export function writeShotAgent(
  episodeId: string,
  shotId: string,
  agent: { provider: string; model?: string | null },
): ShotAgent {
  if (!fs.existsSync(shotDir(episodeId, assertSafeSegment(shotId, "shot")))) throw new Error(`Кадра ${shotId} нет`);
  const checked = checkShotAgent(agent.provider, agent.model);
  const saved: ShotAgent = { ...checked, updatedAt: new Date().toISOString() };
  writeText(agentPath(episodeId, shotId), JSON.stringify(saved, null, 2) + "\n");
  return saved;
}

/**
 * Активный запрос агенту на этапах кадра: сначала работающий, иначе ждущий.
 * Ждущий считается, только пока этап в фазе agent с этим запросом (как в списке агентов доски).
 */
export function readShotAgentActivity(episodeId: string, shotId: string): ShotAgentActivity | null {
  let queued: ShotAgentActivity | null = null;
  for (const stageId of STAGES) {
    try {
      const request = readAgentRequest(episodeId, shotId, stageId);
      if (!request || (request.status !== "pending" && request.status !== "running")) continue;
      const provider = request.provider ?? "manual";
      if (request.status === "running" || isAgentRunLive(episodeId, request.id)) {
        return { stageId, status: "running", since: request.startedAt || request.createdAt, provider };
      }
      const state = readStageStateFile(episodeId, shotId, stageId);
      if (state?.phase !== "agent" || (state.requestId && state.requestId !== request.id)) continue;
      if (!queued) queued = { stageId, status: "queued", since: request.createdAt, provider };
    } catch {
      // Файл этапа ещё пишется.
    }
  }
  return queued;
}
