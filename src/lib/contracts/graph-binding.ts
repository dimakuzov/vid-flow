// Контракт: docs/contracts/graph-binding.md. Только типы. Во время параллельной работы не менять.
import type { StageId } from "../series/constants";

/** Откуда берутся картинки входа. */
export type ImageSource =
  /** refs/ этого этапа */
  | "refs"
  /** approve/ другого этапа этого же кадра */
  | `approve:${StageId}`
  /** data/locations/<shot.location>/ — view.png, иначе первая картинка без «copy» в имени */
  | "library:location";

export type ImagePick = "first" | "newest" | "all";

export interface ImageInput {
  kind: "image";
  /** Источники по порядку: берётся первый непустой. */
  from: ImageSource | ImageSource[];
  /** first — первая по имени (числа по значению), newest — самая новая по mtime, all — все по имени. */
  pick: ImagePick;
  /** Сколько картинок нужно минимум. По умолчанию 1. 0 — вход необязательный. */
  min?: number;
  /** Сколько взять максимум (для pick: all). */
  max?: number;
  /** Имя файла при загрузке в ComfyUI. Плейсхолдеры: {shotId}, {episodeId}, {index}, {ext}. По умолчанию — имя файла. */
  uploadAs?: string;
  /** Подпись для меню и сообщений об ошибке: «Утверждённая локация». */
  label: string;
}

export interface TextInput {
  kind: "text";
  /** Текст для модели — только prompt.md этапа, без фильтров. */
  from: "prompt";
  /** Пустой prompt.md — ошибка, если true. */
  required: boolean;
  label: string;
}

export interface NumberInput {
  kind: "number";
  /** Секунды из текста prompt.md («5 сек», «5s»). Нет числа — значение графа не меняется. */
  from: "prompt:seconds";
  min?: number;
  max?: number;
  label: string;
}

export type BindingInput = ImageInput | TextInput | NumberInput;

/** Куда в графе пишется значение. */
export interface NodeTarget {
  node: string;
  /** Ключ в inputs ноды. Должен существовать в графе. */
  field: string;
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
  /** Картинка входа: имя загруженного файла. index — номер картинки во входе (по умолчанию 0). */
  | { input: string; index?: number }
  /** Текст входа после steps, затем первый подходящий шаблон (если есть). */
  | { input: string; steps?: TextStep[]; templates?: TextTemplate[] }
  /** Новое случайное целое для каждого прогона. */
  | { seed: "random" }
  /** Строка-шаблон: {shotId}, {episodeId}, {stageId}, {workflow}. */
  | { template: string };

export interface BindingSlot {
  targets: NodeTarget[];
  value: SlotValue;
  /**
   * Если значения нет (картинки с таким index нет, текст пуст, секунд нет):
   * - не указано: для обязательного входа — ошибка, иначе оставить значение графа;
   * - remove: эти ноды (field не указан) или ключи inputs (field указан) удалить из графа.
   */
  whenEmpty?: { remove: Array<{ node: string; field?: string }> };
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
