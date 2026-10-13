/** Клавиши доски. Подсказка «?» читает этот список, другие места его не копируют. */

export interface HotkeyItem {
  keys: string;
  action: string;
  scope: "Этап" | "Таблица";
}

export const HOTKEYS: HotkeyItem[] = [
  { keys: "Enter", action: "Отправить агенту, когда курсор в поле «Рекомендация». Shift+Enter — новая строка", scope: "Этап" },
  { keys: "Ctrl+Shift+Enter", action: "Запустить", scope: "Этап" },
  { keys: "A", action: "Утвердить выбранные в output", scope: "Этап" },
  { keys: "← →", action: "Листать картинки в просмотре", scope: "Этап" },
  { keys: "Esc", action: "Закрыть просмотр или меню", scope: "Этап" },
  { keys: "?", action: "Показать этот список", scope: "Этап" },
  { keys: "` / ё", action: "Назад к таблице, к этому кадру", scope: "Этап" },
  { keys: "← → ↑ ↓", action: "Выбрать клетку", scope: "Таблица" },
  { keys: "Enter", action: "Открыть этап выбранной клетки", scope: "Таблица" },
];

/** Фокус в поле ввода: клавиши этапа молчат, кроме Enter в рекомендации. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

/** Открыт просмотр, меню или окно: стрелки и буквы не уходят в таблицу и этап. */
export function overlayOpen(): boolean {
  return Boolean(document.querySelector("[role='dialog'], [data-slot='dialog-content']"));
}
