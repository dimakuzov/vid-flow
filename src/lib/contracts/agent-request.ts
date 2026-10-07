// Контракт: docs/contracts/agent-request.md. Только типы. Во время параллельной работы не менять.
import type { StageId } from "../series/constants";

/**
 * pending   — запрос записан, ждёт исполнителя (ручной агент читает его сам)
 * running   — доска запустила провайдера (Ollama / claude -p), процесс идёт
 * done      — промпт переписан (или агент сам сделал прогон); дальше решает доска
 * error     — провайдер упал, вернул пустой ответ или вышел по таймауту; текст в `error`
 * cancelled — пользователь нажал «Отменить»
 */
export type AgentRequestStatus = "pending" | "running" | "done" | "error" | "cancelled";

/** text — один запрос к LLM, ответ = новый prompt.md. agent — CLI-агент в папке проекта. manual — агент в отдельном чате читает файлы сам. */
export type AgentMode = "text" | "agent" | "manual";

export type AgentProviderId = "manual" | "ollama" | "claude";

export interface RefFingerprint {
  name: string;
  sha256: string;
  bytes: number;
}

/** Файл `agent_request.json` папки этапа. */
export interface AgentRequestFile {
  id: string;
  episodeId: string;
  shotId: string;
  stageId: StageId;
  createdAt: string;
  status: AgentRequestStatus;
  message: string;
  refsChangedByUser: boolean;
  /** Кто исполняет. Нет поля — manual (запросы до контракта). */
  provider?: AgentProviderId;
  /** Модель провайдера (`claude-sonnet-5-5`, модель Ollama). Нет — модель провайдера по умолчанию. */
  model?: string;
  mode?: AgentMode;
  /** Провайдер запущен (running). */
  startedAt?: string;
  /** done / error / cancelled. */
  finishedAt?: string;
  /** Текст ошибки для пользователя (status: error). */
  error?: string;
  /** Агент предлагает другой воркфлоу (id манифеста). Доска показывает, но сама не переключает. */
  suggestedWorkflow?: string;
  /** Расход прогона (доска, после ответа провайдера). */
  usage?: AgentUsage;
  changes: {
    prompt: "changed" | "unchanged" | "no-baseline";
    refsNote: "changed" | "unchanged" | "no-baseline";
    workflowNote: "changed" | "unchanged" | "no-baseline";
    refFilesAdded: string[];
    refFilesRemoved: string[];
    refFilesReplaced: string[];
  };
  current: {
    prompt: string;
    refsNote: string;
    workflowNote: string;
    refFiles: RefFingerprint[];
  };
}

/** Всё, что провайдер получает от доски. Собирает модуль связи с агентом. */
export interface AgentTask {
  request: AgentRequestFile;
  mode: AgentMode;
  /** Абсолютный путь папки этапа. */
  stageDir: string;
  /** Корень репозитория (cwd для CLI-агента). */
  projectRoot: string;
  /** Текст задачи целиком (то же, что в llm_task.md): для agent и manual. */
  taskMarkdown: string;
  /** Для text: системная часть — плейбук модели (.en.md) выбранного воркфлоу. */
  system: string;
  /** Для text: пользовательская часть — сообщение, текущий prompt.md, имена refs, действие кадра. */
  user: string;
  /** Предел времени, после которого провайдер прерывается и запрос уходит в error. */
  timeoutMs: number;
}

export interface AgentResult {
  status: "done" | "error";
  /** text: новый prompt.md ровно так, как уйдёт в модель. Пустой — это error. */
  prompt?: string;
  /** Вывод процесса для run_log.md (agent). */
  log?: string;
  error?: string;
  suggestedWorkflow?: string;
  /** Расход прогона, если провайдер его сообщил. Доска пишет его в run_log.md и agent_request.json. */
  usage?: AgentUsage;
}

/** Расход одного прогона агента. Поля, которых провайдер не сообщил, отсутствуют. */
export interface AgentUsage {
  /** Входные токены без кэша. */
  inputTokens?: number;
  /** Входные токены, записанные в кэш. */
  cacheWriteTokens?: number;
  /** Входные токены, прочитанные из кэша. */
  cacheReadTokens?: number;
  outputTokens?: number;
  /** Оценка по ценам API (claude: total_cost_usd). По подписке деньги не списываются, но лимит тратится так же. */
  costUsd?: number;
  /** Весь прогон, мс. */
  durationMs?: number;
  /** Из них ожидание ответа модели, мс. */
  apiDurationMs?: number;
  /** Ходов модели (агентный режим). */
  turns?: number;
}

/** Модель провайдера в меню: id уходит провайдеру как есть (`claude --model`, модель Ollama). */
export interface ModelChoice {
  id: string;
  label: string;
}

export interface AgentProvider {
  id: AgentProviderId;
  /** Подпись в меню: «Ollama (qwen3)», «Claude (подписка)», «Вручную (чат читает файлы)». */
  label: string;
  /** Какие режимы умеет. manual — только manual. */
  modes: AgentMode[];
  /**
   * Есть ли провайдер на этой машине (ответил Ollama, найден `claude`). Причина — в reason.
   * models — модели на выбор, defaultModel — какая стоит по умолчанию.
   */
  check(): Promise<{ available: boolean; reason?: string; models?: ModelChoice[]; defaultModel?: string | null }>;
  /** manual не вызывается: запрос ждёт, пока агент сам поставит done. */
  run(task: AgentTask, signal: AbortSignal): Promise<AgentResult>;
}

/** Ответ `GET /api/agent/providers`. */
export interface AgentProviderInfo {
  id: AgentProviderId;
  label: string;
  modes: AgentMode[];
  available: boolean;
  reason: string | null;
  /** Провайдер по умолчанию (FRAMEBOARD_AGENT_PROVIDER). */
  isDefault: boolean;
  /** Модели на выбор. Пусто — у провайдера нет выбора модели (ручной режим). */
  models: ModelChoice[];
  defaultModel: string | null;
}
