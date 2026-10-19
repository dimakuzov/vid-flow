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
  /** Пусто — источник пока пустой, граф этот вход не получит. */
  files: MediaFile[];
  /** Файлы входа, которые пользователь убрал из графа (на диске остаются, их можно вернуть). */
  excluded: MediaFile[];
  /** Имя персонажа, если строка — его картинка в графе (image 1). */
  characterName?: string;
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
  /** Текст кадра из shot.md, если своей правки фрагмента ещё нет. */
  summary?: string;
  /** Правка фрагмента сценария в карточке. null — правки нет, показывается сырой кусок. */
  fragment?: string | null;
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
  /** Кадры на диске, скрытые из таблицы галкой импорта. Файлы у них на месте. */
  hiddenShots: ShotSummary[];
  /** Все кадры эпизода в порядке таблицы, включая скрытые. Номера папок тут не меняются. */
  shotOrder: string[];
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
  /** `- location:` кадра: имя папки в `data/locations/`. */
  location: string;
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
  /** Убранные из графа файлы этапа: пути как MediaFile.relativePath (run_settings.json). */
  excluded: string[];
  /** Картинки персонажей предыдущего кадра (approve и output). null — это первый кадр или не этап персонажей. */
  previousShot: { id: string; files: MediaFile[] } | null;
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
  /**
   * Только первый кадр (run_settings.json): дальность персонажей до камеры (имя строчными →
   * background | full | waist | face) и подписи к файлам refs/ (имя файла → текст). Иначе null.
   */
  firstFrame: { framing: Record<string, string>; refNotes: Record<string, string> } | null;
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
  /**
   * Первый кадр и видео: действие кадра под утверждённые картинки (`shots/{shotId}/action.md`)
   * и что на этих картинках на самом деле. null — этапу это не нужно.
   */
  shotContext: {
    action: string;
    /** Текст правил пользователь: модель учитывает его как замечание. */
    actionEditedByUser: boolean;
    /** Основа изменилась (картинки, shot.md, замечания): агент перепишет действие при следующей отправке. */
    actionStale: boolean;
    images: {
      kind: "location" | "character" | "first_frame";
      subject: string | null;
      name: string;
      /** Описание. null — ещё нет. */
      text: string | null;
      /** Модель смотрит картинку прямо сейчас. */
      describing: boolean;
    }[];
  } | null;
  /** Замечания пользователя к кадру со всех этапов (`shots/{shotId}/notes.json`), старые первыми. */
  notes: { id: string; at: string; stageId: StageId; stageLabel: string; message: string }[];
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
