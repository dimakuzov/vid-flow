"use client";

import { useEffect, useRef, useState } from "react";
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
      fallbackError: "Не удалось прочитать библиотеку",
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
  }, [open]);

  async function pick(locationId: string) {
    setPending(locationId);
    setError("");
    try {
      const data = await requestJson<{ message: string; stage: StageDetail }>(
        `${stageApi}/refs-from-library`,
        { method: "POST", body: { locationId, writeToShot }, fallbackError: "Не удалось взять локацию" },
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
        Из библиотеки
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-label="Локации из библиотеки"
          className="absolute left-0 z-30 mt-1 grid w-[min(22rem,calc(100vw-2rem))] gap-2 rounded-lg border border-stone-200 bg-white p-2 shadow-lg"
        >
          <p className="text-xs text-stone-500">
            data/locations/ — общий вид ляжет в refs/ и станет входом графа.
          </p>
          {locations === null && !error ? <p className="text-xs text-stone-500">Загрузка…</p> : null}
          {locations?.length === 0 ? (
            <p className="text-xs text-stone-500">В data/locations/ нет папок.</p>
          ) : null}
          {locations?.length ? (
            <ul className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto">
              {locations.map((location) => (
                <li key={location.id}>
                  <button
                    type="button"
                    disabled={!location.thumbnail || pending !== null}
                    onClick={() => void pick(location.id)}
                    title={location.thumbnail ? location.id : `${location.id}: нет картинки`}
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
                        нет
                      </span>
                    )}
                    <span className="truncate">{pending === location.id ? "Копирую…" : location.id}</span>
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
            Записать в кадр (location в shot.md)
          </label>
          {error ? <p className="text-xs text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
