"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/language";
import { Button } from "@/components/ui/button";
import type { RefSourceFile, RefSourceGroup } from "@/lib/series/ref-sources";
import type { StageDetail } from "@/lib/series/types";
import { errorText, requestJson } from "./api";

/** Имя папки локации из пути `locations/{id}/файл`. */
function locationOf(file: RefSourceFile): string {
  return file.path.split("/")[1] ?? "";
}

/**
 * Кнопка «Из библиотеки» у референсов этапа «Локация»: все картинки `data/locations/`,
 * сначала локации кадра, ниже остальные. Выбранная картинка копируется в refs/.
 */
export function LocationLibrary({
  stageApi,
  location,
  disabled,
  onPicked,
}: {
  stageApi: string;
  /** Локация кадра: её картинки идут первыми. */
  location: string;
  disabled?: boolean;
  onPicked: (stage: StageDetail, message: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<RefSourceFile[] | null>(null);
  const [writeToShot, setWriteToShot] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    requestJson<{ groups: RefSourceGroup[] }>(`${stageApi}/ref-sources`, {
      fallbackError: t("loc.readFailed"),
    })
      .then((data) => {
        if (!stopped) setFiles(data.groups.find((group) => group.id === "locations")?.files ?? []);
      })
      .catch((err) => {
        if (!stopped) setError(errorText(err));
      });
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      stopped = true;
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open, stageApi, t]);

  async function pick(file: RefSourceFile) {
    setPending(file.path);
    setError("");
    try {
      let data = await requestJson<{ message: string; stage: StageDetail }>(`${stageApi}/ref-sources`, {
        method: "POST",
        body: { paths: [file.path] },
        fallbackError: t("loc.takeFailed"),
      });
      if (writeToShot && locationOf(file) !== location) {
        const stage = await requestJson<StageDetail>(stageApi, {
          method: "PATCH",
          body: { location: locationOf(file) },
          fallbackError: t("loc.changeFailed"),
        });
        data = { message: data.message, stage };
      }
      setOpen(false);
      onPicked(data.stage, data.message);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div ref={box} className="relative inline-block">
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setError("");
          setOpen((value) => !value);
        }}
      >
        {t("loc.library")}
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-label={t("loc.libraryLabel")}
          className="absolute left-0 z-30 mt-1 grid w-[min(30rem,calc(100vw-2rem))] gap-2 rounded-lg border border-stone-200 bg-white p-2 shadow-lg"
        >
          <p className="text-xs text-stone-500">
            {t("loc.libraryLead")}
          </p>
          {files === null && !error ? <p className="text-xs text-stone-500">{t("common.loading")}</p> : null}
          {files?.length === 0 ? <p className="text-xs text-stone-500">{t("loc.libraryEmpty")}</p> : null}
          {files?.length ? (
            <div className="max-h-96 space-y-3 overflow-y-auto">
              {[
                { id: "current", title: t("loc.libCurrent", { id: location }), items: files.filter((file) => locationOf(file) === location) },
                { id: "others", title: t("loc.libOthers"), items: files.filter((file) => locationOf(file) !== location) },
              ]
                .filter((group) => group.items.length)
                .map((group) => (
                  <section key={group.id}>
                    <h4 className="text-xs font-medium text-stone-600">{group.title}</h4>
                    <ul className="mt-1 grid grid-cols-3 gap-2">
                      {group.items.map((file) => (
                        <li key={file.path}>
                          <button
                            type="button"
                            disabled={pending !== null}
                            onClick={() => void pick(file)}
                            title={`${locationOf(file)} · ${file.name}`}
                            className="grid w-full gap-1 rounded-md p-1 text-left text-xs text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/media/${file.path.split("/").map(encodeURIComponent).join("/")}`}
                              alt=""
                              loading="lazy"
                              className="aspect-square w-full rounded object-cover"
                            />
                            <span className="truncate">{pending === file.path ? t("common.copying") : `${locationOf(file)} · ${file.name}`}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-xs text-stone-600">
            <input
              type="checkbox"
              checked={writeToShot}
              onChange={(event) => setWriteToShot(event.target.checked)}
            />
            {t("loc.writeShot")}
          </label>
          {error ? <p className="text-xs text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
