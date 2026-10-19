"use client";

import { useState } from "react";
import { useT } from "@/components/language";
import type { Translate } from "@/lib/i18n";
import type { MediaFile } from "@/lib/series/types";
import { MediaCard } from "./media-card";

function subjectKey(filename: string, shotId: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  const shotSuffix = `_${shotId}`;
  if (base.endsWith(shotSuffix)) return base.slice(0, -shotSuffix.length);
  const cut = base.indexOf("_");
  return cut === -1 ? base : base.slice(0, cut);
}

function refRole(filename: string, tr: Translate): string {
  const base = filename.replace(/\.[^.]+$/, "");
  if (base.endsWith("_outfit")) return tr("refs.role.outfit");
  if (base.endsWith("_pose")) return tr("refs.role.pose");
  if (base.endsWith("_face")) return tr("refs.role.face");
  return tr("refs.role.file");
}

/**
 * Подпись файла refs/ («шлем Лены»): сохраняется по Enter или при уходе из поля, если изменилась.
 * Родитель ставит key по сохранённому тексту, чтобы поле обновилось после ответа доски.
 */
function RefNoteInput({
  file,
  saved,
  onSave,
}: {
  file: MediaFile;
  saved: string;
  onSave?: (file: MediaFile, text: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState(saved);
  const commit = () => {
    if (onSave && text.trim() !== saved.trim()) onSave(file, text);
  };
  return (
    <input
      className="h-8 w-full rounded-md border border-stone-300 bg-white px-2 text-xs text-stone-800 placeholder:text-stone-400 disabled:opacity-60"
      value={text}
      placeholder={t("refs.notePlaceholder")}
      disabled={!onSave}
      maxLength={300}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

/** refs/, относящиеся к выбранным (или всем) вариантам в output/: по имени персонажа. */
export function usedRefNames(
  refs: MediaFile[],
  output: MediaFile[],
  selectedOutput: string[],
  shotId: string,
): string[] {
  const picked = selectedOutput.length
    ? output.filter((file) => selectedOutput.includes(file.name))
    : output;
  const subjects = new Set(picked.map((file) => subjectKey(file.name, shotId)));
  return refs
    .filter((file) => subjects.has(subjectKey(file.name, shotId)))
    .map((file) => file.name);
}

export function RefFiles({
  files,
  selectedName,
  usedNames,
  onSelect,
  onOpen,
  excluded,
  onToggleExclude,
  notes,
  onSaveNote,
}: {
  files: MediaFile[];
  selectedName: string | null;
  usedNames: string[];
  onSelect: (name: string) => void;
  onOpen: (file: MediaFile) => void;
  /** Убранные из графа файлы этапа (MediaFile.relativePath). */
  excluded: string[];
  /** Убрать из графа (true) или вернуть (false). Нет — этап занят. */
  onToggleExclude?: (file: MediaFile, exclude: boolean) => void;
  /** Первый кадр: подписи файлов (имя → текст). Нет — поле подписи не показывается. */
  notes?: Record<string, string>;
  /** Сохранить подпись. Нет при заданных notes — этап занят, поле только для чтения. */
  onSaveNote?: (file: MediaFile, text: string) => void;
}) {
  const t = useT();
  const removed = new Set(excluded);
  const selected = files.find((file) => file.name === selectedName) ?? null;
  const used = new Set(usedNames);

  if (!files.length) {
    return <p className="text-sm text-stone-500">{t("refs.empty")}</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-stone-500">
        {selected
          ? t("refs.openOne", { role: refRole(selected.name, t), name: selected.name })
          : usedNames.length
            ? t("refs.usedList", { names: usedNames.join(", ") })
            : t("refs.hint")}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {files.map((file) => (
          <div key={file.relativePath} className="space-y-1">
          <MediaCard
            file={file}
            selected={file.name === selectedName}
            onSelect={() => onSelect(file.name)}
            onOpen={() => onOpen(file)}
            excluded={removed.has(file.relativePath)}
            onToggleExclude={
              onToggleExclude ? () => onToggleExclude(file, !removed.has(file.relativePath)) : undefined
            }
            caption={`${refRole(file.name, t)}${used.has(file.name) ? t("refs.used") : ""}`}
          />
          {notes ? <RefNoteInput key={notes[file.name] ?? ""} file={file} saved={notes[file.name] ?? ""} onSave={onSaveNote} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
