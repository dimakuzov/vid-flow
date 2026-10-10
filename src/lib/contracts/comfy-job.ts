// Контракт: docs/contracts/comfy-job.md. Только типы. Во время параллельной работы не менять.

export type ComfyJobStatus = "pending" | "running" | "done" | "error" | "cancelled";

export type ApiPrompt = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export interface ComfyNodeError {
  node: string;
  classType?: string;
  /** Читаемый текст: «LoadImage: файл location.png не найден». */
  message: string;
}

/** Файл `data/comfy_queue/<id>.json`. */
export interface ComfyJob {
  id: string;
  status: ComfyJobStatus;
  /** Чей прогон. Пишет постановщик (stage-run). Ручные задания (агент на characters) могут не иметь. */
  episodeId?: string;
  shotId?: string;
  stageId?: string;
  /** id манифеста графа (graph-binding). */
  workflow?: string;
  /**
   * `cloud` — задание идёт в Comfy Cloud (cloud.comfy.org), а не в локальный ComfyUI. Платно:
   * ставится только с разрешением пользователя и никогда не отправляется повторно сам.
   */
  target?: "cloud";
  prompt: ApiPrompt;
  /** Файлы для POST /upload/image перед отправкой. path — от cwd, внутри data/ или playbooks/. */
  uploads?: { path: string; filename?: string }[];
  /** Куда сохранить результат. От cwd, внутри data/. */
  saveTo: string;
  /**
   * Сохранить и текстовые выходы нод (`PreviewAny` и т.п.: `outputs[node].text`) как `{node}.txt` в saveTo.
   * Для графов без картинок (распознавание речи). Только локальный ComfyUI.
   */
  saveText?: boolean;
  /** id в ComfyUI после POST /prompt. */
  promptId?: string;
  /** Время постановки (постановщик). */
  queuedAt?: string;
  /** ComfyUI принял prompt (очередь). */
  submittedAt?: string;
  /** done / error / cancelled (очередь или отмена). */
  finishedAt?: string;
  /** Место в очереди ComfyUI: 0 — выполняется, 1 — следующий. null — неизвестно или ещё не отправлено. */
  queuePosition?: number | null;
  /** Имена сохранённых файлов в saveTo. Уникальные: старые результаты не затираются. */
  files?: string[];
  /** Короткий текст ошибки для пользователя. */
  error?: string;
  /** Ошибки нод из ответа ComfyUI, по одной на ноду. */
  nodeErrors?: ComfyNodeError[];
  updatedAt?: string;
}

/** То, что видит интерфейс (StageDetail.job). Собирается из файла задания без записи. */
export interface JobSummary {
  id: string;
  status: ComfyJobStatus;
  workflow: string | null;
  queuedAt: string | null;
  submittedAt: string | null;
  finishedAt: string | null;
  queuePosition: number | null;
  files: string[];
  error: string | null;
  nodeErrors: ComfyNodeError[];
}
