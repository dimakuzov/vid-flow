"use client";

import type { ImageEditRecord } from "@/lib/series/mutations";
import type { MediaFile, StageDetail } from "@/lib/series/types";
import { MediaCard } from "./media-card";
import { CharacterApproveTools } from "./prev-shot-buttons";

/** Подпись «из чего сделан» для файла в output/. */
function madeFrom(name: string, edits: ImageEditRecord[]): { caption?: string; title?: string } {
  const found = [...edits].reverse().find((item) => item.file === name);
  if (!found) return {};
  const kind = found.kind === "crop" ? "обрезка" : "правка";
  return { caption: `${kind} из ${found.from}`, title: found.prompt };
}

export function OutputPanel({
  detail,
  edits,
  disabled,
  selectedOutput,
  onToggle,
  onOpen,
  onApprove,
  onRemoveApproved,
  onDelete,
  onEdit,
  stageApi,
  onStage,
}: {
  detail: StageDetail;
  edits: ImageEditRecord[];
  disabled: boolean;
  selectedOutput: string[];
  onToggle: (name: string) => void;
  onOpen: (files: MediaFile[], file: MediaFile, folder: "output" | "approve") => void;
  onApprove: (names: string[]) => void;
  onRemoveApproved: (name: string) => void;
  /** Удалить файл из output/ насовсем. Разрешено и у занятого этапа. */
  onDelete: (name: string) => void;
  onEdit: (file: MediaFile, folder: "output" | "approve") => void;
  stageApi: string;
  onStage: (stage: StageDetail | null, message: string) => void;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-stone-200 bg-white/90 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Output</h2>
      <div className="mt-4">
        <h3 className="text-sm font-medium text-stone-800">approve/</h3>
        {detail.stageId === "characters" ? (
          <CharacterApproveTools stageApi={stageApi} disabled={disabled} onDone={onStage} />
        ) : null}
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {detail.approve.length ? (
            detail.approve.map((file) => (
              <MediaCard
                key={file.relativePath}
                file={file}
                onOpen={() => onOpen(detail.approve, file, "approve")}
                onRemove={disabled ? undefined : () => onRemoveApproved(file.name)}
                onEdit={() => onEdit(file, "approve")}
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
            detail.output.map((file) => {
              const origin = madeFrom(file.name, edits);
              return (
              <MediaCard
                key={file.relativePath}
                file={file}
                selected={selectedOutput.includes(file.name)}
                onSelect={() => onToggle(file.name)}
                onOpen={() => onOpen(detail.output, file, "output")}
                onApprove={disabled ? undefined : () => onApprove([file.name])}
                onDelete={disabled ? undefined : () => onDelete(file.name)}
                onEdit={() => onEdit(file, "output")}
                caption={origin.caption}
                captionTitle={origin.title}
              />
              );
            })
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
