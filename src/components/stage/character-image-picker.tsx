"use client";

import { useState } from "react";
import { useT } from "@/components/language";
import { Button } from "@/components/ui/button";
import type { MediaFile } from "@/lib/series/types";

/**
 * Три источника картинки персонажа (image 1): output этого кадра, refs/, предыдущий кадр.
 * Выбранный файл идёт в граф как есть, без переименования.
 */
export function CharacterImagePicker({
  output,
  refs,
  previous,
  disabled,
  onPick,
}: {
  output: MediaFile[];
  refs: MediaFile[];
  previous: { id: string; files: MediaFile[] } | null;
  disabled?: boolean;
  onPick: (file: MediaFile) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState<"output" | "refs" | "previous" | null>(null);
  const images = (files: MediaFile[]) => files.filter((file) => file.kind === "image");
  const lists = {
    output: images(output),
    refs: images(refs),
    previous: images(previous?.files ?? []),
  };
  const current = open ? lists[open] : [];

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="outline" size="xs" disabled={disabled} onClick={() => setOpen(open === "output" ? null : "output")}>
          {t("pick.output")}
        </Button>
        <Button type="button" variant="outline" size="xs" disabled={disabled} onClick={() => setOpen(open === "refs" ? null : "refs")}>
          {t("pick.ref")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled || !previous}
          title={previous ? t("pick.shot", { id: previous.id }) : t("pick.first")}
          onClick={() => setOpen(open === "previous" ? null : "previous")}
        >
          {t("pick.prev")}
        </Button>
      </div>
      {open ? (
        <div className="rounded-md border border-stone-200 bg-white p-2">
          {current.length ? (
            <ul className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {current.map((file) => (
                <li key={file.relativePath}>
                  <button
                    type="button"
                    disabled={disabled}
                    title={file.name}
                    onClick={() => {
                      setOpen(null);
                      onPick(file);
                    }}
                    className="grid w-full gap-1 rounded-md p-1 text-left text-xs text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={file.url} alt="" className="aspect-[3/4] w-full rounded object-cover" />
                    <span className="truncate">{file.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-stone-500">
              {open === "output"
                ? t("pick.noOutput")
                : open === "refs"
                  ? t("pick.noRefs")
                  : t("pick.noPrev", { id: previous?.id ?? "" })}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
