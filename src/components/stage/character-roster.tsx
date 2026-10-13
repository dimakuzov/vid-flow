"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

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
  const [draft, setDraft] = useState("");

  return (
    <div className="space-y-2 rounded-lg border border-stone-200 bg-stone-50/60 p-3">
      <div className="text-xs font-medium text-stone-600">
        Персонажи кадра{" "}
        <span className="font-normal text-stone-400">
          нажмите имя — референсы выше станут его. Снять галку — убрать из кадра, файлы на диске остаются.
        </span>
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
                    aria-label={`Убрать ${name}`}
                    disabled={disabled}
                    onChange={() => {
                      if (!window.confirm(`Убрать ${name} из кадра? Файлы в refs/ останутся.`)) return;
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
                  {selected ? <span className="text-xs text-stone-400">редактируется</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-stone-500">В кадре никого. Добавьте имя ниже.</p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const name = draft.trim();
          if (!name || disabled) return;
          onChange([...names, name]);
          setDraft("");
        }}
      >
        <input
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="имя, латиница"
          aria-label="Новый персонаж"
          className="h-8 min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-2 text-sm"
        />
        <Button type="submit" variant="outline" disabled={disabled || !draft.trim()}>
          Добавить
        </Button>
      </form>
      {active ? (
        <p className="text-xs text-stone-500">
          База этого персонажа — файл <span className="font-mono">{active}_base</span>, одежда —{" "}
          <span className="font-mono">{active}_clothes</span>. Загрузка без такого начала имени получит префикс{" "}
          <span className="font-mono">{active}_</span>. Промпт — раздел <span className="font-mono">## {active}</span>.
        </p>
      ) : null}
    </div>
  );
}
