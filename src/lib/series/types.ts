import type { StageId, StageStatus } from "./constants";

export type MediaKind = "image" | "video" | "other";

export interface MediaFile {
  name: string;
  relativePath: string;
  kind: MediaKind;
  url: string;
}

export interface StageSummary {
  id: StageId;
  status: StageStatus;
  outputCount: number;
  approveCount: number;
  expectedApproveCount: number;
  thumbnails: MediaFile[];
  canAutoReady: boolean;
}

export interface ShotSummary {
  id: string;
  title: string;
  characters: string[];
  location: string;
  stages: Record<StageId, StageSummary>;
}

export interface SeriesSummary {
  id: string;
  title: string;
  description: string;
  root: string;
  episodeId: string | null;
  episodeTitle: string;
  episodes: string[];
  shots: ShotSummary[];
  scenarioExists: boolean;
  hasRawScenario: boolean;
  formatRequestStatus: "pending" | "done" | null;
}

export interface StageDetail {
  shotId: string;
  shotTitle: string;
  stageId: StageId;
  stageLabel: string;
  status: StageStatus;
  expectedCharacters: string[];
  docs: {
    prompt: string;
    llmNotes: string;
    refs: string;
    workflow: string;
  };
  refs: MediaFile[];
  output: MediaFile[];
  approve: MediaFile[];
  playbooks: string[];
  relativeDir: string;
  agentRequest: {
    status: "pending" | "done";
    createdAt: string;
    refsChangedByUser: boolean;
  } | null;
}

export interface BootstrapShotDraft {
  id: string;
  title: string;
  summary: string;
  characters: string[];
  location: string;
}

export interface BootstrapPreview {
  seriesTitle: string;
  shots: BootstrapShotDraft[];
}
