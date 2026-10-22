"use client";

import { useT } from "@/components/language";
import type { MessageKey } from "@/lib/i18n";
import { DocFieldLabel } from "./doc-field";

/** Варианты от дальнего к ближнему. Значения — как в run_settings.json (first-frame-settings.ts). */
const FRAMINGS = ["background", "full", "waist", "face"] as const;

/**
 * Первый кадр: на каждого персонажа кадра — дальность до камеры. Значение есть всегда: при создании
 * кадра его ставит разметка сценария, дальше — выбор пользователя.
 * Выбор сохраняется сразу и не сбрасывается при отправке агенту.
 */
export function FramingPicker({
  characters,
  framing,
  disabled,
  onChange,
}: {
  characters: string[];
  framing: Record<string, string>;
  disabled: boolean;
  onChange: (name: string, value: string | null) => void;
}) {
  const t = useT();
  if (!characters.length) return null;
  return (
    <div className="space-y-2">
      <DocFieldLabel note={t("framing.note")}>{t("framing.title")}</DocFieldLabel>
      <div className="space-y-1.5">
        {characters.map((name) => {
          const key = name.toLowerCase();
          return (
            <label key={key} className="flex items-center justify-between gap-3 text-sm text-stone-800">
              <span className="min-w-0 truncate">{name}</span>
              <select
                className="h-8 rounded-md border border-stone-300 bg-white px-2 text-sm text-stone-800 disabled:opacity-60"
                value={framing[key] ?? "full"}
                disabled={disabled}
                onChange={(event) => onChange(key, event.target.value)}
              >
                {FRAMINGS.map((value) => (
                  <option key={value} value={value}>
                    {t(`framing.${value}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    </div>
  );
}
