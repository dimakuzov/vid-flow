"use client";

import { useState } from "react";
import { useT } from "@/components/language";
import { Button } from "@/components/ui/button";
import { nextPickIndex, pickPosition } from "@/lib/series/character-pick";
import type { MediaFile } from "@/lib/series/types";

type Source = "output" | "refs" | "previous";

/**
 * Три источника картинки персонажа (image 1): output этого кадра, refs/, предыдущий кадр.
 * Нажатие сразу ставит картинку персонажем, без списка и второго клика. Если в источнике несколько
 * картинок, каждое следующее нажатие берёт следующую, после последней — первую.
 * Выбранный файл идёт в граф как есть, без переименования.
 */
export function CharacterImagePicker({
  output,
  refs,
  previous,
  current,
  disabled,
  onPick,
}: {
  output: MediaFile[];
  refs: MediaFile[];
  previous: { id: string; files: MediaFile[] } | null;
  /** Путь картинки, которая сейчас стоит персонажем (MediaFile.relativePath), если есть. */
  current: string | null;
  disabled?: boolean;
  onPick: (file: MediaFile) => void;
}) {
  const t = useT();
  const [empty, setEmpty] = useState<Source | null>(null);
  const images = (files: MediaFile[]) => files.filter((file) => file.kind === "image");
  const lists: Record<Source, MediaFile[]> = {
    output: images(output),
    refs: images(refs),
    previous: images(previous?.files ?? []),
  };

  function press(source: Source) {
    const list = lists[source];
    const index = nextPickIndex(
      list.map((file) => file.relativePath),
      current,
    );
    if (index < 0) {
      setEmpty(source);
      return;
    }
    setEmpty(null);
    onPick(list[index]);
  }

  /** «2/3», когда текущая картинка из этого источника и их несколько. */
  function position(source: Source): string {
    const list = lists[source];
    const at = pickPosition(
      list.map((file) => file.relativePath),
      current,
    );
    return at && list.length > 1 ? ` ${at}/${list.length}` : "";
  }

  const cycle = t("pick.cycle");
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="outline" size="xs" disabled={disabled} title={cycle} onClick={() => press("output")}>
          {t("pick.output")}
          {position("output")}
        </Button>
        <Button type="button" variant="outline" size="xs" disabled={disabled} title={cycle} onClick={() => press("refs")}>
          {t("pick.ref")}
          {position("refs")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled || !previous}
          title={previous ? t("pick.shot", { id: previous.id }) : t("pick.first")}
          onClick={() => press("previous")}
        >
          {t("pick.prev")}
          {position("previous")}
        </Button>
      </div>
      {empty ? (
        <p className="text-xs text-stone-500">
          {empty === "output" ? t("pick.noOutput") : empty === "refs" ? t("pick.noRefs") : t("pick.noPrev", { id: previous?.id ?? "" })}
        </p>
      ) : null}
    </div>
  );
}
