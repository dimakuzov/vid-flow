/** Клавиши доски. Подсказка «?» читает этот список, другие места его не копируют. */

import type { MessageKey } from "@/lib/i18n";

export interface HotkeyItem {
  keys: string;
  action: MessageKey;
  scope: "stage" | "board";
}

export const HOTKEYS: HotkeyItem[] = [
  { keys: "Enter", action: "hotkey.stage.enter", scope: "stage" },
  { keys: "A", action: "hotkey.stage.approve", scope: "stage" },
  { keys: "← →", action: "hotkey.stage.arrows", scope: "stage" },
  { keys: "Esc", action: "hotkey.stage.esc", scope: "stage" },
  { keys: "?", action: "hotkey.stage.help", scope: "stage" },
  { keys: "` / ё", action: "hotkey.stage.back", scope: "stage" },
  { keys: "← → ↑ ↓", action: "hotkey.board.arrows", scope: "board" },
  { keys: "Enter", action: "hotkey.board.enter", scope: "board" },
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
