import type { AgentProviderId, AgentRequestStatus } from "../contracts/agent-request";
import type { JobSummary } from "../contracts/comfy-job";
import type { DurationRange, WorkflowChoice } from "../contracts/graph-binding";
import type { StageId, StageStatus } from "./constants";
import type { StageState } from "./stage-state";

export type { DurationRange, JobSummary, WorkflowChoice };

export type MediaKind = "image" | "video" | "other";

export interface MediaFile {
  name: string;
  relativePath: string;
  kind: MediaKind;
  url: string;
}

/** Картинки или видео, которые этап возьмёт на вход. Только для показа. */
export interface StageInput {
  /** Что это за вход: «Утверждённая локация». */
  label: string;
  /** Откуда файлы: «approve этапа Локация», «refs/ этого этапа», «библиотека data/locations/cafe/». */
  source: string;
  /** true — файлы из refs/ этого этапа (их можно удалить на странице). */
  fromRefs: boolean;
  /** Пусто — источник пока пустой, граф этот вход не получит. */
  files: MediaFile[];
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
  /** Агент кадра (`agent.json`). null — не назначен. */
  agent: ShotAgentChoice | null;
  /** Что сейчас делает агент на кадре; provider — кем идёт запрос. null — свободен. */
  agentActivity: { stageId: StageId; status: "running" | "queued"; since: string; provider: AgentProviderId } | null;
}

/** Провайдер и модель агента кадра. model null — модель провайдера по умолчанию. */
export interface ShotAgentChoice {
  provider: AgentProviderId;
  model: string | null;
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
  formatRequestStatus: "pending" | "running" | "done" | "error" | null;
  /** Разметка сценария: кто размечает, ошибка, сколько кадров создано. null — запроса нет. */
  formatRequest: {
    status: "pending" | "running" | "done" | "error";
    provider: string;
    model: string | null;
    error: string | null;
    shots: number | null;
  } | null;
}

export interface StageDetail {
  episodeId: string;
  shotId: string;
  shotTitle: string;
  /** Действие кадра из shot.md (раздел Summary). Только для чтения. */
  shotSummary: string;
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
    /** Прямая речь кадра (`shots/{shotId}/speech.md`). Пусто — молчат. Только при `hasSpeech`. */
    speech: string;
  };
  /** На странице этапа есть поле «Реплики» (видео-этапы). */
  hasSpeech: boolean;
  promptHistory: { id: string; savedAt: string; prompt: string }[];
  refs: MediaFile[];
  output: MediaFile[];
  approve: MediaFile[];
  /** Что уйдёт в граф по умолчанию, включая approve других этапов и библиотеки. */
  inputs: StageInput[];
  playbooks: string[];
  relativeDir: string;
  state: StageState;
  /** Выбранный воркфлоу (run_settings.json). null — вариант по умолчанию (WorkflowChoice.isDefault). */
  workflow: string | null;
  /** Воркфлоу этапа для меню, по order. Пусто — доска этот этап не запускает. */
  workflows: WorkflowChoice[];
  /** Выбранная длительность клипа, с (run_settings.json, в пределах durationRange). null — по умолчанию. */
  durationSec: number | null;
  /** Меню длительности для воркфлоу, который уйдёт в запуск. null — у него нет входа settings:seconds. */
  durationRange: DurationRange | null;
  /** Последнее задание очереди этапа (stage_state.jobId). */
  job: JobSummary | null;
  agentRequest: {
    status: AgentRequestStatus;
    createdAt: string;
    refsChangedByUser: boolean;
    /** Пусто — manual (запросы до контракта agent-request). */
    provider: AgentProviderId | null;
    error: string | null;
    suggestedWorkflow: string | null;
    comfy: "wait" | "queued" | "error" | "agent" | "cancelled" | null;
    comfyJobId: string | null;
    comfyError: string | null;
  } | null;
  watch: {
    stopped: boolean;
    stoppedAt: string | null;
    videoDone: boolean;
  };
  /** Агент кадра: «Отправить агенту» берёт его по умолчанию. null — не назначен. */
  shotAgent: ShotAgentChoice | null;
}

export interface BootstrapShotDraft {
  id: string;
  title: string;
  summary: string;
  characters: string[];
  location: string;
  /** Реплики кадра дословно (`- speech:` в scenario.md), одна на строку. Нет — в кадре молчат. */
  speech?: string[];
  /** Длительность клипа в секундах (`- duration:` в scenario.md). Нет — по умолчанию графа. */
  durationSec?: number;
}

export interface BootstrapPreview {
  seriesTitle: string;
  shots: BootstrapShotDraft[];
}
