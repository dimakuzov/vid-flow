"use client";

import { useT } from "@/components/language";
import { graphInputLabel } from "@/lib/i18n";
import type { MediaFile, StageInput } from "@/lib/series/types";
import { CharacterImagePicker } from "./character-image-picker";
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
  characterSources,
  onPickCharacter,
}: {
  inputs: StageInput[];
  /** true — этап запускает доска (есть воркфлоу), false — граф гоняет агент. */
  boardRuns: boolean;
  onOpen: (files: MediaFile[], file: MediaFile) => void;
  /** Убрать из графа (true) или вернуть (false). Нет — этап занят, входы не меняются. */
  onToggleExclude?: (file: MediaFile, exclude: boolean) => void;
  /** Откуда взять картинку персонажа. Нет — кнопки не показываются. */
  characterSources?: {
    output: MediaFile[];
    refs: MediaFile[];
    previous: { id: string; files: MediaFile[] } | null;
  };
  onPickCharacter?: (name: string, file: MediaFile) => void;
}) {
  const t = useT();
  if (!inputs.length) return null;
  return (
    <div className="space-y-3 rounded-lg border border-stone-200 bg-stone-50/60 p-3">
      <div className="text-xs font-medium text-stone-600">
        {t("graph.title")}{" "}
        <span className="font-normal text-stone-400">
          {boardRuns ? t("graph.board") : t("graph.agent")}
          {t("graph.excludeNote")}
        </span>
      </div>
      {inputs.map((input) => (
        <div key={`${input.label}-${input.source}`} className="space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="text-stone-700">{graphInputLabel(t, input.label)}</span>
            <span className={input.files.length ? "text-stone-400" : "text-amber-700"}>
              {input.source}
            </span>
          </div>
          {input.characterName && characterSources && onPickCharacter ? (
            <CharacterImagePicker
              output={characterSources.output}
              refs={characterSources.refs}
              previous={characterSources.previous}
              current={input.files[0]?.relativePath ?? null}
              disabled={!onToggleExclude}
              onPick={(file) => onPickCharacter(input.characterName!, file)}
            />
          ) : null}
          {input.files.length || input.excluded.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {input.files.map((file) => (
                <MediaCard
                  key={file.relativePath}
                  file={file}
                  compact
                  onOpen={() => onOpen(input.files, file)}
                  onToggleExclude={
                    onToggleExclude
                      ? () => {
                          // Картинка персонажа — основа прогона: случайный клик по «Убрать» оставляет этап без неё.
                          if (input.characterName && !window.confirm(t("graph.confirmRemoveCharacter", { name: input.characterName, file: file.name }))) return;
                          onToggleExclude(file, true);
                        }
                      : undefined
                  }
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
