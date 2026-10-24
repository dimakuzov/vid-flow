"use client";

import { useT } from "@/components/language";
import type { MessageKey } from "@/lib/i18n";
import { DocFieldLabel } from "./doc-field";

/** Варианты от дальнего к ближнему. Значения — как в run_settings.json (first-frame-settings.ts). */
const FRAMINGS = ["background", "full", "waist", "face"] as const;

/**
 * Первый кадр: на каждого персонажа кадра — дальность до камеры. Значение есть всегда: при создании
 * кадра его ставит разметка сценария, дальше — выбор пользователя.
 * Выбор сохраняется сразу и не сбрасывается при отправке агенту. Галка «Спиной»: лица не видно,
 * портрет в граф не идёт; по сценарию она ставится сама.
 */
export function FramingPicker({
  characters,
  framing,
  backView,
  disabled,
  onChange,
  onBackView,
}: {
  characters: string[];
  framing: Record<string, string>;
  backView: string[];
  disabled: boolean;
  onChange: (name: string, value: string | null) => void;
  onBackView: (name: string, value: boolean) => void;
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
            <div key={key} className="flex items-center justify-between gap-3 text-sm text-stone-800">
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <label className="flex shrink-0 items-center gap-1 text-xs text-stone-600" title={t("framing.backTitle")}>
                <input
                  type="checkbox"
                  checked={backView.includes(key)}
                  disabled={disabled}
                  onChange={(event) => onBackView(key, event.target.checked)}
                />
                {t("framing.back")}
              </label>
              <select
                aria-label={name}
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
