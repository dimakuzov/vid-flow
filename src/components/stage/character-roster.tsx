"use client";

import { useState } from "react";
import { useT } from "@/components/language";
import { Button } from "@/components/ui/button";
import { errorText, requestJson } from "./api";

/** Файл относится к персонажу: `lena.png`, `lena_clothes.png`, `lena-base.png`. */
export function characterOwnsFile(filename: string, name: string): boolean {
  const stem = filename.replace(/\.[^.]+$/, "").toLowerCase();
  const id = name.toLowerCase();
  return stem === id || stem.startsWith(`${id}_`) || stem.startsWith(`${id}-`);
}

/**
 * Панель персонажей кадра. Галка снята — имя уходит из shot.md.
 * Нажатие на имя выбирает, чьи референсы показывать.
 */
export function CharacterRoster({
  names,
  active,
  disabled,
  onSelect,
  onChange,
}: {
  names: string[];
  active: string | null;
  disabled: boolean;
  onSelect: (name: string) => void;
  onChange: (names: string[]) => void;
}) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const [options, setOptions] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  return (
    <div className="space-y-2 rounded-lg border border-stone-200 bg-stone-50/60 p-3">
      <div className="text-xs font-medium text-stone-600">
        {t("roster.title")}{" "}
        <span className="font-normal text-stone-400">{t("roster.note")}</span>
      </div>
      {names.length ? (
        <ul className="space-y-1">
          {names.map((name) => {
            const selected = active?.toLowerCase() === name.toLowerCase();
            return (
              <li key={name}>
                <div
                  className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm ${
                    selected ? "bg-white ring-1 ring-stone-300" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked
                    aria-label={t("roster.remove", { name })}
                    disabled={disabled}
                    onChange={() => {
                      if (!window.confirm(t("roster.confirm", { name }))) return;
                      onChange(names.filter((item) => item !== name));
                    }}
                  />
                  <button
                    type="button"
                    className="text-left"
                    disabled={disabled}
                    onClick={() => onSelect(name)}
                  >
                    {name}
                  </button>
                  {selected ? <span className="text-xs text-stone-400">{t("roster.editing")}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-stone-500">{t("roster.empty")}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            const next = !picking;
            setPicking(next);
            setError("");
            if (!next || options) return;
            requestJson<{ characters: string[] }>("/api/library/characters", {
              fallbackError: t("roster.readFailed"),
            })
              .then((data) => setOptions(data.characters))
              .catch((err) => setError(errorText(err)));
          }}
        >
          {t("roster.add")}
        </Button>
        {picking ? (
          <select
            aria-label={t("roster.pick")}
            defaultValue=""
            disabled={disabled || !options}
            className="h-8 min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-2 text-sm"
            onChange={(event) => {
              const name = event.target.value;
              if (!name || disabled) return;
              onChange([...names, name]);
              setPicking(false);
            }}
          >
            <option value="">{options ? t("roster.choose") : t("common.loading")}</option>
            {(options ?? [])
              .filter((name) => !names.some((item) => item.toLowerCase() === name.toLowerCase()))
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
        ) : null}
      </div>
      {picking && options && !options.length ? (
        <p className="text-xs text-stone-500">{t("roster.noLibrary")}</p>
      ) : null}
      {error ? <p className="text-xs text-red-800">{error}</p> : null}
      {active ? (
        <p className="text-xs text-stone-500">
          {t("roster.hint", { name: active })}
        </p>
      ) : null}
    </div>
  );
}
