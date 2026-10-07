"use client";

import type { MediaFile, StageDetail } from "@/lib/series/types";
import { MediaCard } from "./media-card";

export function OutputPanel({
  detail,
  disabled,
  selectedOutput,
  onToggle,
  onOpen,
  onApprove,
  onRemoveApproved,
  onDelete,
}: {
  detail: StageDetail;
  disabled: boolean;
  selectedOutput: string[];
  onToggle: (name: string) => void;
  onOpen: (files: MediaFile[], file: MediaFile) => void;
  onApprove: (names: string[]) => void;
  onRemoveApproved: (name: string) => void;
  /** Удалить файл из output/ насовсем. Разрешено и у занятого этапа. */
  onDelete: (name: string) => void;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-stone-200 bg-white/90 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Output</h2>
      <div className="mt-4">
        <h3 className="text-sm font-medium text-stone-800">approve/</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {detail.approve.length ? (
            detail.approve.map((file) => (
              <MediaCard
                key={file.relativePath}
                file={file}
                onOpen={() => onOpen(detail.approve, file)}
                onRemove={disabled ? undefined : () => onRemoveApproved(file.name)}
              />
            ))
          ) : (
            <p className="text-sm text-stone-500">Ещё ничего не утверждено</p>
          )}
        </div>
      </div>
      <div className="mt-6">
        <h3 className="text-sm font-medium text-stone-800">output/</h3>
        <p className="mt-1 text-xs text-stone-500">
          Имя файла выделяет вариант. Слева остаются референсы этого персонажа. Картинка открывается
          на весь экран, там же — промпт и seed, с которыми её сделал ComfyUI.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {detail.output.length ? (
            detail.output.map((file) => (
              <MediaCard
                key={file.relativePath}
                file={file}
                selected={selectedOutput.includes(file.name)}
                onSelect={() => onToggle(file.name)}
                onOpen={() => onOpen(detail.output, file)}
                onApprove={disabled ? undefined : () => onApprove([file.name])}
                onDelete={disabled ? undefined : () => onDelete(file.name)}
              />
            ))
          ) : (
            <p className="text-sm text-stone-500">Вариантов пока нет</p>
          )}
        </div>
      </div>
      {detail.stageId === "characters" ? (
        <p className="mt-4 text-xs text-stone-500">
          Отметьте имя файла в output и нажмите «Утвердить выбранные». Для персонажа файл встанет
          как <code>{"{character}_" + detail.shotId + ".png"}</code>
          {detail.expectedCharacters.length
            ? ` · ожидаются: ${detail.expectedCharacters.join(", ")}`
            : ""}
        </p>
      ) : (
        <p className="mt-4 text-xs text-stone-500">
          В approve для этого этапа хранится один выбранный файл.
        </p>
      )}
    </section>
  );
}
