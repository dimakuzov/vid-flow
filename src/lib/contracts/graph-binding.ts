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
  | "library:faces"
  /**
   * По одной картинке на персонажа из approve/ этапа characters, в том же порядке: лист лица
   * (`{name}_face_sheet`), иначе лицо (как у library:faces), иначе сам утверждённый персонаж.
   */
  | "library:faces-or-characters"
  /**
   * Листы лица персонажей из approve/ этапа characters, в том же порядке: `refs/{name}_face_sheet.*`
   * этапа, иначе картинка с face_sheet в имени в data/characters/{name}/. Без листа персонаж пропускается.
   */
  | "library:face-sheets"
  /**
   * База одного персонажа прогона (`forEach: character`): full_body.png, иначе body.png,
   * иначе первая картинка без «copy» в data/characters/{имя}/.
   */
  | "library:character";

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
  /**
   * Вариант доступен, только если файлов не больше этого числа: `1` у входа персонажей —
   * «в кадре один персонаж» (замена головы MiniMax). Больше — вариант недоступен, с подписью почему.
   */
  maxAvailable?: number;
  /** Имя файла при загрузке в ComfyUI. Плейсхолдеры: {shotId}, {episodeId}, {index}, {ext}. По умолчанию — имя файла. */
  uploadAs?: string;
  /**
   * Вход подключается, только если prompt.md этапа совпал с этим регэкспом (флаг i).
   * Так агент сам решает, нужен ли вход: например, лицо — фразой `face from image N`.
   */
  whenPrompt?: string;
  /**
   * Для источника `refs`: оставить файлы, чьё имя совпадает с шаблоном.
   * `{character}` — имя персонажа прогона, `*` — любая концовка (`{character}_base*`).
   * К библиотеке не применяется: там свои имена файлов.
   */
  match?: string;
  /** Подпись для меню и сообщений об ошибке: «Утверждённая локация». */
  label: string;
}

/** Нода промпта в графе, который ComfyUI записал в ролик (ключ `prompt`). */
export interface PromptNodeRef {
  node: string;
  field: string;
}

/**
 * Как узнать, каким графом сделан ролик: нода в метаданных, иначе подстрока имени файла.
 * Метаданные важнее имени: файл могли переименовать при утверждении.
 */
export interface SketchMatch {
  /** Имя входа kind: video этого манифеста. Берётся самый новый файл. */
  of: string;
  /** Ролик сделан этим графом, если в метаданных есть такая нода с непустым текстом. Первая подходящая. */
  nodes: PromptNodeRef[];
  /** Запасной признак, только если метаданных нет: подстрока имени файла, например `_ltx`. */
  filename?: string;
}

export interface TextInput {
  kind: "text";
  /**
   * `prompt` — prompt.md.
   * `approve-meta` — текст ноды из метаданных самого нового ролика входа `of`
   * (SaveVideo пишет граф в ключ `prompt` контейнера mp4/mov).
   */
  from: "prompt" | "approve-meta";
  /** Для approve-meta: имя входа kind: video, чей самый новый файл читать. */
  of?: string;
  /** Для approve-meta: ноды промпта в сохранённом графе. Первая, у которой в поле непустой текст. */
  nodes?: PromptNodeRef[];
  /**
   * Для approve-meta: нет метаданных или нет ни одной ноды — взять prompt.md.
   * Чей файл — поле `stage` (нет — этап запуска).
   */
  fallback?: "prompt";
  /**
   * Чей prompt.md: по умолчанию этого этапа.
   * Для `from: prompt` — откуда читать. Для `approve-meta` — чей prompt.md запасной.
   */
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
   * Разделы — имена персонажей кадра, строчными буквами (`## lena`).
   * Вместо фиксированного `sections`. Нужен прогону `forEach: character`.
   */
  sectionsFrom?: "characters";
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
  /**
   * true — число вне min..max прижимается к границе, а не отбрасывается (иначе осталось бы
   * значение графа). Для платных моделей: 4-секундное превью не должно превратиться в 9 секунд.
   */
  clamp?: boolean;
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
  /** Картинка или ролик входа: имя загруженного файла. index — номер файла во входе (по умолчанию 0). */  | { input: string; index?: number }
  /**
   * Файл номер index из нескольких входов подряд (файлы первого входа, затем второго…).
   * Так ряд нод `image_2`…`image_6` заполняется без пропусков, сколько бы файлов ни было в каждом входе.
   */
  | { inputs: string[]; index?: number }
  /**
   * Текст входа: раздел section (если у входа есть sections), затем steps, затем первый подходящий шаблон.
   * required — пустой раздел даёт ошибку (без whenEmpty).
   */
  | { input: string; section?: string; required?: boolean; steps?: TextStep[]; templates?: TextTemplate[] }
  /** Новое случайное целое для каждого прогона; max — верхняя граница ноды (HeyGen: 2^32 − 1). */
  | { seed: "random"; max?: number }
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
  /**
   * Как модель называет картинки: `<Picture {n}>` (MiniMax H3). Есть — агент получает в задаче
   * список картинок графа под этими именами, на любом этапе. Нет — `image {n}`, список только
   * на первом кадре.
   */
  imageLabel?: string;
  /** Порядок в меню. Вариант по умолчанию — первый по order, у которого есть все обязательные входы. */
  order: number;
  /**
   * Когда вариант может быть по умолчанию: `speech` — только если в кадре есть реплики (speech.md),
   * `dialogue` — реплики от двух и более говорящих, `silent` — реплик нет. Нет поля — всегда.
   * Подходящего нет — первый доступный.
   */
  defaultWhen?: "speech" | "dialogue" | "silent";
  /**
   * Вариант по умолчанию, если утверждённый ролик сделан этим графом.
   * Важнее `defaultWhen`: эскиз LTX → финал LTX, даже если в кадре есть реплики.
   * Нет совпадения — обычные правила `defaultWhen`.
   */
  whenSketch?: SketchMatch;
  /**
   * `cloud` — прогон идёт в Comfy Cloud (платно, ключ COMFY_CLOUD_API_KEY), только с разрешением
   * пользователя на этот запуск. Нет поля — локальный ComfyUI.
   */
  target?: "cloud";
  /** Цена прогона в Comfy Cloud, для окна разрешения. */
  cost?: CloudCost;
  /** Старое имя для совместимости (`i2v`, `flf`). */
  aliases?: string[];
  /**
   * `character` — отдельный прогон на каждого персонажа кадра (shot.md).
   * Плейсхолдер `{character}` в match, uploadAs, template и section слота.
   */
  forEach?: "character";
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
  /** Платный запуск в Comfy Cloud: нужна галочка разрешения на странице этапа. null — локальный ComfyUI. */
  cloud: CloudCost | null;
}

/** Цена прогона в Comfy Cloud: credits за perSeconds секунд видео. */
export interface CloudCost {
  credits: number;
  perSeconds: number;
}
