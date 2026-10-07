"use client";

import type { MediaFile } from "@/lib/series/types";
import { MediaCard } from "./media-card";

function subjectKey(filename: string, shotId: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  const shotSuffix = `_${shotId}`;
  if (base.endsWith(shotSuffix)) return base.slice(0, -shotSuffix.length);
  const cut = base.indexOf("_");
  return cut === -1 ? base : base.slice(0, cut);
}

function refRole(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  if (base.endsWith("_outfit")) return "образ";
  if (base.endsWith("_pose")) return "поза";
  if (base.endsWith("_face")) return "лицо";
  return "файл";
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
  onDelete,
}: {
  files: MediaFile[];
  selectedName: string | null;
  usedNames: string[];
  onSelect: (name: string) => void;
  onOpen: (file: MediaFile) => void;
  /** Нет — этап занят, удалять refs/ нельзя. */
  onDelete?: (name: string) => void;
}) {
  const selected = files.find((file) => file.name === selectedName) ?? null;
  const used = new Set(usedNames);

  if (!files.length) {
    return <p className="text-sm text-stone-500">В refs/ пока нет файлов.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-stone-500">
        {selected
          ? `${refRole(selected.name)} · ${selected.name}. Картинка открывается на весь экран.`
          : usedNames.length
            ? `Использованы: ${usedNames.join(", ")}.`
            : "Имя под картинкой выделяет файл. Сама картинка открывается на весь экран."}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {files.map((file) => (
          <MediaCard
            key={file.relativePath}
            file={file}
            selected={file.name === selectedName}
            onSelect={() => onSelect(file.name)}
            onOpen={() => onOpen(file)}
            onDelete={onDelete ? () => onDelete(file.name) : undefined}
            caption={`${refRole(file.name)}${used.has(file.name) ? " · использован" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}
