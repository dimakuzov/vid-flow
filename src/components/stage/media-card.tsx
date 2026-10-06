"use client";

import Image from "next/image";
import type { MediaFile } from "@/lib/series/types";

export function MediaCard({
  file,
  selected,
  onSelect,
  onOpen,
  onRemove,
  caption,
  onApprove,
}: {
  file: MediaFile;
  selected?: boolean;
  onSelect?: () => void;
  onOpen?: () => void;
  onRemove?: () => void;
  caption?: string;
  onApprove?: () => void;
}) {
  return (
    <div
      className={`w-full min-w-0 rounded-xl border p-2 text-left ${
        selected ? "border-teal-700 bg-teal-50" : "border-stone-200 bg-white"
      }`}
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
            className="max-h-96 w-full rounded-lg bg-stone-100 object-contain"
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
        <button
          type="button"
          onClick={onSelect}
          className="mt-2 w-full truncate text-left text-xs text-stone-600"
        >
          {selected ? "Выбрано · " : ""}
          {caption ? `${caption} · ` : ""}
          {file.name}
        </button>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-stone-600">
          <span className="truncate">
            {caption ? `${caption} · ` : ""}
            {file.name}
          </span>
          {onRemove ? (
            <button type="button" onClick={onRemove} className="shrink-0 text-stone-500 underline">
              Убрать
            </button>
          ) : null}
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
