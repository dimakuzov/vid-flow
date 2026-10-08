"use client";

import type { MediaFile, StageInput } from "@/lib/series/types";
import { MediaCard } from "./media-card";

/**
 * «Что уйдёт в граф»: входы этапа по умолчанию, включая approve других этапов и библиотеки.
 * Любой файл можно убрать из графа и вернуть; с диска ничего не удаляется.
 */
export function StageInputs({
  inputs,
  boardRuns,
  onOpen,
  onToggleExclude,
}: {
  inputs: StageInput[];
  /** true — этап запускает доска (есть воркфлоу), false — граф гоняет агент. */
  boardRuns: boolean;
  onOpen: (files: MediaFile[], file: MediaFile) => void;
  /** Убрать из графа (true) или вернуть (false). Нет — этап занят, входы не меняются. */
  onToggleExclude?: (file: MediaFile, exclude: boolean) => void;
}) {
  if (!inputs.length) return null;
  return (
    <div className="space-y-3 rounded-lg border border-stone-200 bg-stone-50/60 p-3">
      <div className="text-xs font-medium text-stone-600">
        Что уйдёт в граф{" "}
        <span className="font-normal text-stone-400">
          {boardRuns ? "по умолчанию, при выбранном воркфлоу" : "агент берёт эти файлы по плейбуку"}
          {" · «Убрать» не удаляет файл, а только не отдаёт его в граф"}
        </span>
      </div>
      {inputs.map((input) => (
        <div key={`${input.label}-${input.source}`} className="space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="text-stone-700">{input.label}</span>
            <span className={input.files.length ? "text-stone-400" : "text-amber-700"}>
              {input.source}
            </span>
          </div>
          {input.files.length || input.excluded.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {input.files.map((file) => (
                <MediaCard
                  key={file.relativePath}
                  file={file}
                  compact
                  onOpen={() => onOpen(input.files, file)}
                  onToggleExclude={onToggleExclude ? () => onToggleExclude(file, true) : undefined}
                />
              ))}
              {input.excluded.map((file) => (
                <MediaCard
                  key={`excluded-${file.relativePath}`}
                  file={file}
                  compact
                  excluded
                  onOpen={() => onOpen(input.excluded, file)}
                  onToggleExclude={onToggleExclude ? () => onToggleExclude(file, false) : undefined}
                />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
