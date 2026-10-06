import { STAGES, type StageId } from "./constants";
import { assertSafeSegment, normalizeEpisodeId } from "./paths";

/** Параметры пути `/api/episodes/[episodeId]/shots/[shotId]/...`. Бросает ошибку на чужой формат. */
export function parseShotParams(params: { episodeId: string; shotId: string }): {
  episodeId: string;
  shotId: string;
} {
  return {
    episodeId: normalizeEpisodeId(params.episodeId),
    shotId: assertSafeSegment(params.shotId, "кадр"),
  };
}

/** Параметры пути `/api/episodes/[episodeId]/shots/[shotId]/stages/[stage]/...`. */
export function parseStageParams(params: { episodeId: string; shotId: string; stage: string }): {
  episodeId: string;
  shotId: string;
  stageId: StageId;
} {
  if (!STAGES.includes(params.stage as StageId)) throw new Error("Неизвестный этап");
  return { ...parseShotParams(params), stageId: params.stage as StageId };
}

export type StageRouteContext = {
  params: Promise<{ episodeId: string; shotId: string; stage: string }>;
};

export type ShotRouteContext = { params: Promise<{ episodeId: string; shotId: string }> };
