"use client";

import { Trash2Icon } from "lucide-react";
import Image from "next/image";
import type { MediaFile } from "@/lib/series/types";

function DeleteButton({ name, onDelete }: { name: string; onDelete: () => void }) {
  return (
    <button
      type="button"
      onClick={onDelete}
      className="shrink-0 rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-700"
      aria-label={`Удалить ${name} навсегда`}
      title="Удалить файл навсегда"
    >
      <Trash2Icon className="size-3.5" />
    </button>
  );
}

/** «Убрать из графа» / «Вернуть»: файл остаётся на диске. */
function ExcludeButton({ excluded, onToggle }: { excluded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="shrink-0 text-stone-500 underline hover:text-stone-800"
      title={excluded ? "Снова отдавать этот файл в граф" : "Не отдавать файл в граф. С диска он не удаляется"}
    >
      {excluded ? "Вернуть" : "Убрать"}
    </button>
  );
}

export function MediaCard({
  file,
  selected,
  onSelect,
  onOpen,
  onRemove,
  caption,
  captionTitle,
  onEdit,
  onApprove,
  onDelete,
  compact,
  excluded,
  onToggleExclude,
}: {
  file: MediaFile;
  selected?: boolean;
  onSelect?: () => void;
  onOpen?: () => void;
  onRemove?: () => void;
  caption?: string;
  /** Подсказка подписи: промпт правки, из которой сделан файл. */
  captionTitle?: string;
  /** «Править» — только у картинки. */
  onEdit?: () => void;
  onApprove?: () => void;
  /** Корзина: удалить файл с диска. Подтверждение спрашивает вызывающий. */
  onDelete?: () => void;
  /** Миниатюра: картинка ниже, для списка входов. */
  compact?: boolean;
  /** Файл убран пользователем из графа этапа: карточка бледная, подпись «убран из графа». */
  excluded?: boolean;
  /** Убрать из графа / вернуть. Нет — переключателя нет (этап занят). */
  onToggleExclude?: () => void;
}) {
  const shownCaption = [excluded ? "убран из графа" : "", caption ?? ""].filter(Boolean).join(" · ");
  const editButton =
    onEdit && file.kind === "image" ? (
      <button type="button" onClick={onEdit} className="shrink-0 text-stone-500 underline hover:text-stone-800">
        Править
      </button>
    ) : null;
  return (
    <div
      className={`w-full min-w-0 rounded-xl border p-2 text-left ${
        selected ? "border-teal-700 bg-teal-50" : "border-stone-200 bg-white"
      } ${excluded ? "opacity-50" : ""}`}
    >
      {file.kind === "image" ? (
        <button
          type="button"
          onClick={onOpen}
          className="block w-full cursor-zoom-in"
          aria-label={`Открыть ${file.name} на весь экран`}
        >
          <Image
            src={file.url}
            alt={file.name}
            width={640}
            height={960}
            unoptimized
            className={`${compact ? "max-h-40" : "max-h-96"} w-full rounded-lg bg-stone-100 object-contain`}
          />
        </button>
      ) : file.kind === "video" ? (
        <video
          src={file.url}
          className="aspect-video w-full rounded-lg bg-black object-contain"
          controls
          preload="metadata"
        />
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-lg bg-stone-100 text-sm text-stone-500">
          {file.name}
        </div>
      )}
      {onSelect ? (
        <div className="mt-2 flex items-center gap-1">
          <button
            type="button"
            onClick={onSelect}
            title={captionTitle}
            className="min-w-0 flex-1 truncate text-left text-xs text-stone-600"
          >
            {selected ? "Выбрано · " : ""}
            {shownCaption ? `${shownCaption} · ` : ""}
            {file.name}
          </button>
          {editButton}
          {onToggleExclude ? <ExcludeButton excluded={Boolean(excluded)} onToggle={onToggleExclude} /> : null}
          {onDelete ? <DeleteButton name={file.name} onDelete={onDelete} /> : null}
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-stone-600">
          <span className="truncate" title={captionTitle}>
            {shownCaption ? `${shownCaption} · ` : ""}
            {file.name}
          </span>
          {editButton}
          {onToggleExclude ? <ExcludeButton excluded={Boolean(excluded)} onToggle={onToggleExclude} /> : null}
          {onRemove ? (
            <button type="button" onClick={onRemove} className="shrink-0 text-stone-500 underline">
              Убрать
            </button>
          ) : null}
          {onDelete ? <DeleteButton name={file.name} onDelete={onDelete} /> : null}
        </div>
      )}
      {onApprove ? (
        <button
          type="button"
          onClick={onApprove}
          className="mt-2 rounded-lg bg-teal-800 px-2 py-1 text-xs text-white"
        >
          Утвердить этот вариант
        </button>
      ) : null}
    </div>
  );
}
