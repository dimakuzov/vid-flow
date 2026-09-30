import fs from "fs";
import path from "path";
import {
  STAGE_LABELS,
  STAGES,
  type StageId,
} from "./constants";
import { listMediaFiles, readTextIfExists } from "./media";
import {
  ensureSeriesScaffold,
  getPlaybooksRoot,
  getSeriesRoot,
  stageDir,
  shotsDir,
  toPosix,
} from "./paths";
import { readShotMeta } from "./shot-meta";
import {
  charactersApproved,
  deriveStageStatus,
  expectedApproveCount,
  locationApproved,
  readStatusFile,
} from "./status";
import { readAgentRequestSummary } from "./agent-request";
import type { SeriesSummary, ShotSummary, StageDetail, StageSummary } from "./types";

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

function stageThumbnails(shotId: string, stageId: StageId) {
  const approve = listMediaFiles(path.join(stageDir(shotId, stageId), "approve"));
  if (approve.length) return approve.slice(0, 3);
  return listMediaFiles(path.join(stageDir(shotId, stageId), "output")).slice(0, 3);
}

function buildStageSummary(shotId: string, stageId: StageId, characters: string[]): StageSummary {
  const upstreamOk =
    stageId !== "first_frame" ||
    (charactersApproved(shotId, characters) && locationApproved(shotId));
  const status = deriveStageStatus(shotId, stageId, characters, upstreamOk);
  const output = listMediaFiles(path.join(stageDir(shotId, stageId), "output"));
  const approve = listMediaFiles(path.join(stageDir(shotId, stageId), "approve"));
  return {
    id: stageId,
    status,
    outputCount: output.length,
    approveCount: approve.length,
    expectedApproveCount: expectedApproveCount(stageId, characters),
    thumbnails: stageThumbnails(shotId, stageId),
    canAutoReady: upstreamOk,
  };
}

export function listShotIds(seriesRoot = getSeriesRoot()): string[] {
  const dir = shotsDir(seriesRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^s\d+$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function scanSeries(): SeriesSummary {
  const root = getSeriesRoot();
  ensureSeriesScaffold(root);
  const seriesMd = readTextIfExists(path.join(root, "series.md"));
  const { title, description } = parseSeriesMarkdown(seriesMd);
  const shots: ShotSummary[] = listShotIds(root).map((shotId) => {
    const meta = readShotMeta(shotId);
    const stages = Object.fromEntries(
      STAGES.map((stageId) => [stageId, buildStageSummary(shotId, stageId, meta.characters)]),
    ) as Record<StageId, StageSummary>;
    return {
      id: shotId,
      title: meta.title,
      characters: meta.characters,
      location: meta.location,
      stages,
    };
  });

  return {
    id: path.basename(root),
    title,
    description,
    root,
    shots,
    scenarioExists: fs.existsSync(path.join(root, "scenario.md")) &&
      readTextIfExists(path.join(root, "scenario.md")).trim().length > 0,
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
  if (stageId === "characters" || stageId === "location" || stageId === "first_frame") {
    candidates.push(path.join("models", "qwen_image.md"));
  }
  if (stageId === "characters") {
    candidates.push(
      path.join("workflows", "comfy", "character_pose_outfit_qwen.json"),
    );
  }
  const withEnglish = candidates.flatMap((rel) =>
    rel.endsWith(".md") ? [rel, rel.replace(/\.md$/, ".en.md")] : [rel],
  );
  return withEnglish
    .filter((rel) => fs.existsSync(path.join(root, rel)))
    .map((rel) => toPosix(rel));
}

export function getStageDetail(shotId: string, stageId: StageId): StageDetail {
  const meta = readShotMeta(shotId);
  const dir = stageDir(shotId, stageId);
  const upstreamOk =
    stageId !== "first_frame" ||
    (charactersApproved(shotId, meta.characters) && locationApproved(shotId));
  const status = deriveStageStatus(shotId, stageId, meta.characters, upstreamOk);
  const stored = readStatusFile(shotId, stageId);

  return {
    shotId,
    shotTitle: meta.title,
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
    },
    refs: listMediaFiles(path.join(dir, "refs")),
    output: listMediaFiles(path.join(dir, "output")),
    approve: listMediaFiles(path.join(dir, "approve")),
    playbooks: playbooksForStage(stageId),
    relativeDir: toPosix(path.relative(getSeriesRoot(), dir)),
    agentRequest: readAgentRequestSummary(shotId, stageId),
  };
}
