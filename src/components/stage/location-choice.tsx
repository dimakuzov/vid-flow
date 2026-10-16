"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { LibraryLocation } from "@/lib/series/library";
import type { StageDetail } from "@/lib/series/types";
import { errorText, requestJson } from "./api";

/**
 * Имя локации кадра: папка в `data/locations/`.
 * Список — существующие папки. «Создать локацию» делает новую пустую папку и записывает её в кадр.
 */
export function LocationChoice({
  stageApi,
  location,
  disabled,
  onChanged,
}: {
  stageApi: string;
  location: string;
  disabled?: boolean;
  onChanged: (stage: StageDetail, message: string) => void;
}) {
  const [locations, setLocations] = useState<LibraryLocation[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    requestJson<{ locations: LibraryLocation[] }>("/api/library/locations", {
      fallbackError: "Не удалось прочитать локации",
    })
      .then((data) => {
        if (!stopped) setLocations(data.locations);
      })
      .catch((err) => {
        if (!stopped) setError(errorText(err));
      });
    return () => {
      stopped = true;
    };
  }, []);

  const busy = Boolean(disabled) || pending;
  const known = locations?.some((item) => item.id === location) ?? false;
  const current = location.trim();

  async function pick(id: string) {
    if (!id || id === location || busy) return;
    setPending(true);
    setError("");
    try {
      const data = await requestJson<StageDetail>(stageApi, {
        method: "PATCH",
        body: { location: id },
        fallbackError: "Не удалось сменить локацию",
      });
      onChanged(data, `Локация кадра: ${data.location}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  async function create() {
    const name = draft.trim();
    if (!name || busy) return;
    setPending(true);
    setError("");
    try {
      const created = await requestJson<{ id: string; locations: LibraryLocation[] }>("/api/library/locations", {
        method: "POST",
        body: { name },
        fallbackError: "Не удалось создать локацию",
      });
      setLocations(created.locations);
      const data = await requestJson<StageDetail>(stageApi, {
        method: "PATCH",
        body: { location: created.id },
        fallbackError: "Папка создана, но кадр не переключён",
      });
      setCreating(false);
      setDraft("");
      onChanged(data, `Локация ${created.id} создана и записана в кадр`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-stone-200 bg-stone-50/60 p-3">
      <div className="text-xs font-medium text-stone-600">
        Локация кадра{" "}
        <span className="font-normal text-stone-400">
          имя папки в data/locations/. Выбор меняет только строку в shot.md.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Локация из библиотеки"
          className="h-8 min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-2 text-sm"
          value={known ? location : ""}
          disabled={busy || !locations}
          onChange={(event) => {
            void pick(event.target.value);
          }}
        >
          {!known ? (
            <option value="">{locations ? (current ? `${current} — нет такой папки` : "не задана") : "Загрузка…"}</option>
          ) : null}
          {(locations ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.id}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setCreating((open) => !open)}>
          Создать локацию
        </Button>
      </div>
      {locations && !locations.length ? (
        <p className="text-xs text-stone-500">В data/locations/ нет локаций.</p>
      ) : null}
      {creating ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            aria-label="Имя новой локации"
            className="h-8 min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-2 text-sm"
            placeholder="kitchen"
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" disabled={busy || !draft.trim()}>
            Создать
          </Button>
        </form>
      ) : null}
      {creating ? (
        <p className="text-xs text-stone-500">Пустая папка. Имя — латиница, цифры, _ и -. Картинку положите в неё сами.</p>
      ) : null}
      {error ? <p className="text-xs text-red-800">{error}</p> : null}
    </div>
  );
}
