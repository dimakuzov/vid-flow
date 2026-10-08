// Контракт: docs/contracts/graph-binding.md. Только типы.
import type { StageId } from "../series/constants";

/** Откуда берутся файлы входа. */
export type ImageSource =
  /** refs/ этого этапа */
  | "refs"
  /** approve/ другого этапа этого же кадра */
  | `approve:${StageId}`
  /** data/locations/<shot.location>/ — view.png, иначе первая картинка без «copy» в имени */
  | "library:location"
  /**
   * Лица персонажей: по одному на файл в approve/ этапа characters, в том же порядке.
   * `refs/{name}_face.*` этого этапа, иначе портрет из data/characters/{name}/.
   */
  | "library:faces";

export type ImagePick = "first" | "newest" | "all";

export interface ImageInput {
  /** image — картинки (png, jpg, webp), video — ролики (mp4, webm, mov, mkv). */
  kind: "image" | "video";
  /** Источники по порядку: берётся первый непустой. */
  from: ImageSource | ImageSource[];
  /** first — первый по имени (числа по значению), newest — самый новый по mtime, all — все по имени. */
  pick: ImagePick;
  /** Сколько файлов нужно минимум. По умолчанию 1. 0 — вход необязательный. */
  min?: number;
  /** Сколько взять максимум (для pick: all). */
  max?: number;
  /** Имя файла при загрузке в ComfyUI. Плейсхолдеры: {shotId}, {episodeId}, {index}, {ext}. По умолчанию — имя файла. */
  uploadAs?: string;
  /**
   * Вход подключается, только если prompt.md этапа совпал с этим регэкспом (флаг i).
   * Так агент сам решает, нужен ли вход: например, лицо — фразой `face from image N`.
   */
  whenPrompt?: string;
  /** Подпись для меню и сообщений об ошибке: «Утверждённая локация». */
  label: string;
}

export interface TextInput {
  kind: "text";
  /** Текст для модели — только prompt.md, без фильтров. */
  from: "prompt";
  /** Чей prompt.md: по умолчанию этого этапа. Например, финал берёт исходный Wan-промпт у video_preview. */
  stage?: StageId;
  /** Пустой prompt.md — ошибка, если true. */
  required: boolean;
  /**
   * Разделы prompt.md: строки `## <имя>` делят текст. Разрешённые имена.
   * Нет поля — разделов нет, весь текст один.
   */
  sections?: string[];
  /**
   * Куда идёт текст без заголовков: `all` — в каждый раздел (так работал prompt.md до разделов),
   * имя раздела — только в него. По умолчанию `all`.
   */
  untitled?: string;
  /**
   * true — каждая реплика из speech.md кадра должна стоять в этом тексте дословно, иначе запуск —
   * ошибка с недостающими репликами. Для моделей, которые сами озвучивают и двигают губы (MiniMax H3).
   */
  requireSpeech?: boolean;
  label: string;
}

export interface NumberInput {
  kind: "number";
  /**
   * prompt:seconds — секунды из текста prompt.md («5 сек», «5s»);
   * media:duration — длительность ролика из входа `of` (секунды, округление до целого);
   * settings:seconds — выбор в меню этапа (`durationSec` в run_settings.json), нет выбора — `fallback`.
   * Нет числа — значение графа не меняется.
   */
  from: "prompt:seconds" | "media:duration" | "settings:seconds";
  /** Для media:duration: имя входа kind: video. */
  of?: string;
  /** Для settings:seconds: откуда число, если в меню выбрано «По умолчанию». Нет — значение графа. */
  fallback?: "prompt:seconds";
  /** Для settings:seconds обязательны: по ним строится меню длительности. */
  min?: number;
  max?: number;
  label: string;
}

/** Выбор длительности в меню этапа: целые секунды min..max, default — что уйдёт без выбора. */
export interface DurationRange {
  min: number;
  max: number;
  /** Число по умолчанию: fallback (секунды из prompt.md), иначе значение графа. */
  default: number;
}

export type BindingInput = ImageInput | TextInput | NumberInput;

/** Куда в графе пишется значение. */
export interface NodeTarget {
  node: string;
  /** Ключ в inputs ноды. Должен существовать в графе. */
  field: string;
  /**
   * Путь внутри поля, если поле — JSON-строка (как `creator_data` у MiniMaxH3Creator):
   * ключи через точку, номера элементов массива — числом: `segments.0.refined.body`.
   * Доска разбирает строку, пишет значение по пути и собирает строку обратно.
   */
  json?: string;
}

/** Правка текста перед подстановкой. Применяются по порядку. */
export type TextStep =
  /** Имена персонажей кадра (shot.md) заменить на эту фразу. */
  | { namesTo: string }
  /** Добавить фразу в начало или конец, если текст не совпадает с unless (регэксп, флаг i). */
  | { ensure: string; at: "start" | "end"; unless?: string; separator: string };

/** Шаблон текста. Строка из одного пустого плейсхолдера удаляется целиком. */
export interface TextTemplate {
  /** Условие выбора шаблона: число картинок во входе. Нет условия — шаблон по умолчанию. */
  when?: { input: string; countAtLeast?: number; countAtMost?: number };
  /** Плейсхолдеры: {text} — результат steps, {shotId}, {episodeId}. */
  text: string;
}

export type SlotValue =
  /** Картинка или ролик входа: имя загруженного файла. index — номер файла во входе (по умолчанию 0). */
  | { input: string; index?: number }
  /**
   * Текст входа: раздел section (если у входа есть sections), затем steps, затем первый подходящий шаблон.
   * required — пустой раздел даёт ошибку (без whenEmpty).
   */
  | { input: string; section?: string; required?: boolean; steps?: TextStep[]; templates?: TextTemplate[] }
  /** Новое случайное целое для каждого прогона. */
  | { seed: "random" }
  /** Строка-шаблон: {shotId}, {episodeId}, {stageId}, {workflow}. */
  | { template: string }
  /** Готовое значение как есть: число, true/false, строка, объект. */
  | { const: unknown };

/** Что удалить из графа, если значения нет. */
export interface Removal {
  node: string;
  /** Без field — удалить ноду целиком (ветка графа, которую она замыкала, не выполнится). */
  field?: string;
  /** Путь внутри JSON-строки поля: ключ удаляется, элемент массива вырезается. */
  json?: string;
}

export interface BindingSlot {
  targets: NodeTarget[];
  value: SlotValue;
  /**
   * Если значения нет (файла с таким index нет, текст или раздел пуст, числа нет):
   * - не указано: для обязательного входа — ошибка, иначе оставить значение графа;
   * - remove: удалить ноды, ключи inputs или пути внутри JSON-строки.
   */
  whenEmpty?: { remove: Removal[] };
}

/** Манифест `playbooks/workflows/comfy/<id>.bind.json`. */
export interface GraphBinding {
  /** Версия формата. */
  format: "frameboard.graph-binding/1";
  /** Уникальный id. Совпадает с именем файла без `.bind.json`. Хранится в run_settings.json этапа и в задании очереди. */
  id: string;
  /** Файл графа в формате API рядом с манифестом. Один граф может иметь несколько манифестов. */
  graph: string;
  stage: StageId;
  /** Название в меню (для пользователя, по-русски). */
  label: string;
  /** Одна строка: когда выбирать. Подробности — в playbook. */
  description: string;
  /** Плейбук модели для агента (английский), путь от playbooks/: models/qwen_location.en.md. */
  playbook?: string;
  /** Порядок в меню. Вариант по умолчанию — первый по order, у которого есть все обязательные входы. */
  order: number;
  /**
   * Когда вариант может быть по умолчанию: `speech` — только если в кадре есть реплики (speech.md),
   * `silent` — только если их нет. Нет поля — всегда. Подходящего нет — первый доступный.
   */
  defaultWhen?: "speech" | "silent";
  /** Старое имя для совместимости (`i2v`, `flf`). */
  aliases?: string[];
  inputs: Record<string, BindingInput>;
  slots: BindingSlot[];
}

/** Вариант воркфлоу для меню этапа. Отдаётся в StageDetail.workflows. */
export interface WorkflowChoice {
  id: string;
  label: string;
  description: string;
  /** Все обязательные входы на месте. */
  available: boolean;
  /** Подписи входов, которых не хватает: «Утверждённая локация». */
  missing: string[];
  /** Вариант по умолчанию для этого этапа сейчас. */
  isDefault: boolean;
  /** Плейбук модели (поле playbook манифеста), путь от playbooks/. Его читает агент в text-режиме. */
  playbook: string | null;
}
