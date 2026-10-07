import fs from "fs";
import path from "path";
import {
  STAGE_LABELS,
  STAGES,
  type StageId,
} from "./constants";
import { listMediaFiles, readTextIfExists } from "./media";
import { syncPromptHistory } from "./prompt-history";
import { readShotWatch } from "./shot-watch";
import { readFormatRequest } from "./format-request";
import {
  episodeRoot,
  getDataRoot,
  getPlaybooksRoot,
  listEpisodeIds,
  listShotIds,
  readCurrentEpisodeId,
  stageDir,
  toPosix,
} from "./paths";
import { readShotMeta } from "./shot-meta";
import {
  deriveStageStatus,
  expectedApproveCount,
  readStatusFile,
} from "./status";
import { readAgentRequestSummary } from "./agent-request";
import { stageDuration } from "../comfy/binding";
import { listWorkflowChoices, resolveWorkflowId } from "../comfy/workflows";
import { readRunSettings } from "./run-settings";
import { stageInputs } from "./stage-inputs";
import { readJobSummary, readStageState } from "./stage-state";
import type { SeriesChoice, SeriesSummary, ShotSummary, StageDetail, StageSummary } from "./types";

function parseSeriesMarkdown(content: string): { title: string; description: string } {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const description = content
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("#"))
    .slice(0, 3)
    .join(" ")
    .trim();
  return {
    title: titleMatch?.[1]?.trim() || "Серия",
    description: description || "Локальный пульт структурирования генерации видео",
  };
}

function stageThumbnails(episodeId: string, shotId: string, stageId: StageId) {
  const approve = listMediaFiles(path.join(stageDir(episodeId, shotId, stageId), "approve"));
  if (approve.length) return approve.slice(0, 3);
  return listMediaFiles(path.join(stageDir(episodeId, shotId, stageId), "output")).slice(0, 3);
}

function buildStageSummary(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  characters: string[],
): StageSummary {
  const status = deriveStageStatus(episodeId, shotId, stageId, characters);
  const state = readStageState(episodeId, shotId, stageId);
  const output = listMediaFiles(path.join(stageDir(episodeId, shotId, stageId), "output"));
  const approve = listMediaFiles(path.join(stageDir(episodeId, shotId, stageId), "approve"));
  return {
    id: stageId,
    status,
    outputCount: output.length,
    outputNames: output.map((file) => file.name),
    approveCount: approve.length,
    expectedApproveCount: expectedApproveCount(stageId, characters),
    thumbnails: stageThumbnails(episodeId, shotId, stageId),
    canAutoReady: true,
    busy: state.busy,
    phaseSince: state.phase === "idle" ? null : state.since,
    phaseError: state.error,
  };
}

function readShow(): { title: string; description: string } {
  return parseSeriesMarkdown(readTextIfExists(path.join(getDataRoot(), "show.md")));
}

function episodeChoiceTitle(episodeId: string): string {
  const root = episodeRoot(episodeId);
  const episodeMd = readTextIfExists(path.join(root, "episode.md"));
  const legacySeriesMd = readTextIfExists(path.join(root, "series.md"));
  const title = parseSeriesMarkdown(episodeMd || legacySeriesMd).title;
  if (title === "Серия" && !episodeMd.trim() && !legacySeriesMd.trim()) return episodeId;
  return title;
}

function listEpisodeChoices(): SeriesChoice[] {
  return listEpisodeIds().map((id) => ({ id, title: episodeChoiceTitle(id) }));
}

function emptySeries(episodes: SeriesChoice[]): SeriesSummary {
  const show = readShow();
  return {
    id: "series",
    title: show.title,
    description: show.description,
    root: getDataRoot(),
    episodeId: null,
    episodeTitle: "",
    episodes,
    shots: [],
    scenarioExists: false,
    hasRawScenario: false,
    formatRequestStatus: null,
    formatRequest: null,
  };
}

/**
 * Сводка эпизода для таблицы. Чтение без записей (кроме истории промпта на странице этапа).
 * Без episodeId — открытый эпизод из `current_episode.txt`.
 */
export function scanSeries(requestedEpisodeId?: string | null): SeriesSummary {
  const episodes = listEpisodeChoices();
  const episodeId = requestedEpisodeId || readCurrentEpisodeId();
  if (!episodeId) return emptySeries(episodes);

  const root = episodeRoot(episodeId);
  if (!fs.existsSync(root)) throw new Error(`Эпизода ${episodeId} нет`);
  const show = readShow();
  const episodeMd = readTextIfExists(path.join(root, "episode.md"));
  const legacySeriesMd = readTextIfExists(path.join(root, "series.md"));
  const episodeTitle = parseSeriesMarkdown(episodeMd || legacySeriesMd).title;
  const formatRequest = readFormatRequest(root);
  const raw = readTextIfExists(path.join(root, "scenario_raw.md"));
  const scenario = readTextIfExists(path.join(root, "scenario.md"));
  const shots: ShotSummary[] = [];
  for (const shotId of listShotIds(episodeId)) {
    try {
      const meta = readShotMeta(episodeId, shotId);
      const stages = Object.fromEntries(
        STAGES.map((stageId) => [
          stageId,
          buildStageSummary(episodeId, shotId, stageId, meta.characters),
        ]),
      ) as Record<StageId, StageSummary>;
      shots.push({
        id: shotId,
        title: meta.title,
        characters: meta.characters,
        location: meta.location,
        stages,
      });
    } catch {
      // A file in this shot is still being written. Keep the rest of the series.
    }
  }

  return {
    id: episodeId,
    title: show.title,
    description: show.description,
    root,
    episodeId,
    episodeTitle: episodeTitle === "Серия" && !episodeMd.trim() && !legacySeriesMd.trim()
      ? episodeId
      : episodeTitle,
    episodes,
    shots,
    scenarioExists: scenario.trim().length > 0,
    hasRawScenario: raw.trim().length > 0,
    formatRequestStatus: formatRequest?.status ?? null,
    formatRequest: formatRequest
      ? {
          status: formatRequest.status,
          provider: formatRequest.provider ?? "manual",
          model: formatRequest.model ?? null,
          error: formatRequest.error ?? null,
          shots: formatRequest.shots ?? null,
        }
      : null,
  };
}

function playbooksForStage(stageId: StageId): string[] {
  const root = getPlaybooksRoot();
  const candidates = [
    path.join("stages", `${stageId}.md`),
    path.join("workflows", `${stageId}_comfy.md`),
  ];
  if (stageId === "video_preview" || stageId === "final_render") {
    candidates.push(path.join("models", "wan_video.md"));
    candidates.push(path.join("models", "minimax_video.md"));
  }
  if (stageId === "video_preview") {
    candidates.push(path.join("workflows", "comfy", "wan22_i2v_sketch_turbo_api.json"));
    candidates.push(path.join("workflows", "comfy", "wan22_flf_sketch_turbo_api.json"));
  }
  if (stageId === "characters") {
    candidates.push(path.join("models", "qwen_image.md"));
  }
  if (stageId === "first_frame") {
    candidates.push(path.join("models", "qwen_first_frame.md"));
    candidates.push(
      path.join("workflows", "comfy", "qwen21_character_compositing.json"),
    );
  }
  if (stageId === "location") {
    candidates.push(path.join("models", "qwen_location.md"));
    candidates.push(
      path.join("workflows", "comfy", "location_views_multiple_angles.json"),
    );
  }
  if (stageId === "characters") {
    candidates.push(
      path.join("workflows", "comfy", "character_outfit_qwen21.json"),
    );
  }
  const withEnglish = candidates.flatMap((rel) =>
    rel.endsWith(".md") ? [rel, rel.replace(/\.md$/, ".en.md")] : [rel],
  );
  return withEnglish
    .filter((rel) => fs.existsSync(path.join(root, rel)))
    .map((rel) => toPosix(rel));
}

/** Воркфлоу, который уйдёт в запуск: выбор этапа, а неизвестный или пустой — вариант по умолчанию. */
export function effectiveWorkflowId(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  requested: string | null | undefined,
): string | null {
  try {
    return resolveWorkflowId(episodeId, shotId, stageId, requested);
  } catch {
    return resolveWorkflowId(episodeId, shotId, stageId, null);
  }
}

export function getStageDetail(episodeId: string, shotId: string, stageId: StageId): StageDetail {
  const meta = readShotMeta(episodeId, shotId);
  const dir = stageDir(episodeId, shotId, stageId);
  if (!fs.existsSync(path.dirname(dir))) throw new Error(`Кадра ${shotId} нет в эпизоде ${episodeId}`);
  const status = deriveStageStatus(episodeId, shotId, stageId, meta.characters);
  const stored = readStatusFile(episodeId, shotId, stageId);
  const state = readStageState(episodeId, shotId, stageId);
  const settings = readRunSettings(episodeId, shotId, stageId);
  const duration = stageDuration({ episodeId, shotId, stageId }, effectiveWorkflowId(episodeId, shotId, stageId, settings.workflow));

  return {
    episodeId,
    shotId,
    shotTitle: meta.title,
    shotSummary: meta.summary,
    stageId,
    stageLabel: STAGE_LABELS[stageId],
    status,
    expectedCharacters: stored.expectedCharacters?.length
      ? stored.expectedCharacters
      : meta.characters,
    docs: {
      prompt: readTextIfExists(path.join(dir, "prompt.md")),
      llmNotes: readTextIfExists(path.join(dir, "llm_notes.md")),
      refs: readTextIfExists(path.join(dir, "refs.md")),
      workflow: readTextIfExists(path.join(dir, "workflow.md")),
      runLog: readTextIfExists(path.join(dir, "run_log.md")),
    },
    promptHistory: syncPromptHistory(episodeId, shotId, stageId),
    refs: listMediaFiles(path.join(dir, "refs")),
    output: listMediaFiles(path.join(dir, "output")),
    approve: listMediaFiles(path.join(dir, "approve")),
    inputs: stageInputs(episodeId, shotId, stageId),
    playbooks: playbooksForStage(stageId),
    relativeDir: toPosix(path.relative(episodeRoot(episodeId), dir)),
    state,
    workflow: settings.workflow ?? null,
    workflows: listWorkflowChoices(episodeId, shotId, stageId),
    durationSec: duration.durationSec,
    durationRange: duration.range,
    job: readJobSummary(state.jobId),
    agentRequest: readAgentRequestSummary(episodeId, shotId, stageId),
    watch: readShotWatch(episodeId, shotId),
  };
}
