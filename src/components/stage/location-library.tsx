"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/language";
import { Button } from "@/components/ui/button";
import type { LibraryLocation } from "@/lib/series/library";
import type { StageDetail } from "@/lib/series/types";
import { errorText, requestJson } from "./api";

/**
 * Кнопка «Из библиотеки» у референсов этапа «Локация»: список `data/locations/`,
 * выбор копирует общий вид в refs/ (`POST .../refs-from-library`).
 */
export function LocationLibrary({
  stageApi,
  disabled,
  onPicked,
}: {
  stageApi: string;
  disabled?: boolean;
  onPicked: (stage: StageDetail, message: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState<LibraryLocation[] | null>(null);
  const [writeToShot, setWriteToShot] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    requestJson<{ locations: LibraryLocation[] }>("/api/library/locations", {
      fallbackError: t("loc.readFailed"),
    })
      .then((data) => {
        if (!stopped) setLocations(data.locations);
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
  }, [open, t]);

  async function pick(locationId: string) {
    setPending(locationId);
    setError("");
    try {
      const data = await requestJson<{ message: string; stage: StageDetail }>(
        `${stageApi}/refs-from-library`,
        { method: "POST", body: { locationId, writeToShot }, fallbackError: t("loc.takeFailed") },
      );
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
          className="absolute left-0 z-30 mt-1 grid w-[min(22rem,calc(100vw-2rem))] gap-2 rounded-lg border border-stone-200 bg-white p-2 shadow-lg"
        >
          <p className="text-xs text-stone-500">
            {t("loc.libraryLead")}
          </p>
          {locations === null && !error ? <p className="text-xs text-stone-500">{t("common.loading")}</p> : null}
          {locations?.length === 0 ? <p className="text-xs text-stone-500">{t("loc.libraryEmpty")}</p> : null}
          {locations?.length ? (
            <ul className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto">
              {locations.map((location) => (
                <li key={location.id}>
                  <button
                    type="button"
                    disabled={!location.thumbnail || pending !== null}
                    onClick={() => void pick(location.id)}
                    title={location.thumbnail ? location.id : t("loc.noImage", { id: location.id })}
                    className="grid w-full gap-1 rounded-md p-1 text-left text-xs text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                  >
                    {location.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/media/${location.thumbnail}`}
                        alt=""
                        loading="lazy"
                        className="aspect-square w-full rounded object-cover"
                      />
                    ) : (
                      <span className="grid aspect-square w-full place-items-center rounded bg-stone-100 text-stone-400">
                        {t("loc.none")}
                      </span>
                    )}
                    <span className="truncate">{pending === location.id ? t("common.copying") : location.id}</span>
                  </button>
                </li>
              ))}
            </ul>
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
