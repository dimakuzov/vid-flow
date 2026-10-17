"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/language";
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
  const t = useT();
  const [locations, setLocations] = useState<LibraryLocation[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    requestJson<{ locations: LibraryLocation[] }>("/api/library/locations", {
      fallbackError: t("loc.readListFailed"),
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
  }, [t]);

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
        fallbackError: t("loc.changeFailed"),
      });
      onChanged(data, t("loc.changed", { name: data.location }));
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
        fallbackError: t("loc.createFailed"),
      });
      setLocations(created.locations);
      const data = await requestJson<StageDetail>(stageApi, {
        method: "PATCH",
        body: { location: created.id },
        fallbackError: t("loc.switchFailed"),
      });
      setCreating(false);
      setDraft("");
      onChanged(data, t("loc.created", { name: created.id }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-stone-200 bg-stone-50/60 p-3">
      <div className="text-xs font-medium text-stone-600">
        {t("loc.shot")}{" "}
        <span className="font-normal text-stone-400">{t("loc.shotNote")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t("loc.pickLabel")}
          className="h-8 min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-2 text-sm"
          value={known ? location : ""}
          disabled={busy || !locations}
          onChange={(event) => {
            void pick(event.target.value);
          }}
        >
          {!known ? (
            <option value="">{locations ? (current ? t("loc.missingFolder", { id: current }) : t("loc.unset")) : t("common.loading")}</option>
          ) : null}
          {(locations ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.id}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setCreating((open) => !open)}>
          {t("loc.create")}
        </Button>
      </div>
      {locations && !locations.length ? (
        <p className="text-xs text-stone-500">{t("loc.noLocations")}</p>
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
            aria-label={t("loc.newName")}
            className="h-8 min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-2 text-sm"
            placeholder="kitchen"
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" disabled={busy || !draft.trim()}>
            {t("loc.createDo")}
          </Button>
        </form>
      ) : null}
      {creating ? (
        <p className="text-xs text-stone-500">{t("loc.createHint")}</p>
      ) : null}
      {error ? <p className="text-xs text-red-800">{error}</p> : null}
    </div>
  );
}
