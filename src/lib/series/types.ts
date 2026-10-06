import type { StageId, StageStatus } from "./constants";
import type { StageState } from "./stage-state";

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
  outputNames: string[];
  approveCount: number;
  expectedApproveCount: number;
  thumbnails: MediaFile[];
  canAutoReady: boolean;
  /** Идёт операция (агент или ComfyUI): запуск и отправка агенту закрыты. */
  busy: boolean;
  phaseSince: string | null;
  phaseError: string | null;
}

export interface ShotSummary {
  id: string;
  title: string;
  characters: string[];
  location: string;
  stages: Record<StageId, StageSummary>;
}

export interface SeriesChoice {
  id: string;
  title: string;
}

export interface SeriesSummary {
  id: string;
  title: string;
  description: string;
  root: string;
  episodeId: string | null;
  episodeTitle: string;
  episodes: SeriesChoice[];
  shots: ShotSummary[];
  scenarioExists: boolean;
  hasRawScenario: boolean;
  formatRequestStatus: "pending" | "done" | null;
}

export interface StageDetail {
  episodeId: string;
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
    runLog: string;
  };
  promptHistory: { id: string; savedAt: string; prompt: string }[];
  refs: MediaFile[];
  output: MediaFile[];
  approve: MediaFile[];
  playbooks: string[];
  relativeDir: string;
  state: StageState;
  agentRequest: {
    status: "pending" | "done" | "cancelled";
    createdAt: string;
    refsChangedByUser: boolean;
    comfy: "wait" | "queued" | "error" | "agent" | "cancelled" | null;
    comfyJobId: string | null;
    comfyError: string | null;
  } | null;
  watch: {
    stopped: boolean;
    stoppedAt: string | null;
    videoDone: boolean;
  };
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
