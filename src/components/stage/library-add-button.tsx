"use client";

import { useState } from "react";
import { useT } from "@/components/language";
import type { MediaFile } from "@/lib/series/types";
import { errorText, requestJson } from "./api";
import { characterOwnsFile } from "./character-roster";

/**
 * «Add to library» под картинкой в output/ и approve/.
 * Персонажи: в `data/characters/{имя}/styled/`; если из имени файла персонаж не ясен, спрашивает, чей он.
 * Локация: в папку локации кадра в `data/locations/`.
 */
export function LibraryAddButton({
  stageApi,
  kind,
  folder,
  file,
  characters,
  disabled,
  onDone,
}: {
  stageApi: string;
  kind: "character" | "location";
  folder: "output" | "approve";
  file: MediaFile;
  /** Персонажи кадра: из них выбирается владелец картинки. */
  characters: string[];
  disabled?: boolean;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [character, setCharacter] = useState("");

  async function add(owner?: string) {
    setPending(true);
    try {
      const data = await requestJson<{ savedAs: string; target: string }>(`${stageApi}/library-add`, {
        method: "POST",
        body: { folder, filename: file.name, character: owner },
        fallbackError: t("lib.addFailed"),
      });
      setChoosing(false);
      onDone(
        t(kind === "character" ? "lib.addedCharacter" : "lib.addedLocation", { file: data.savedAs, name: data.target }),
      );
    } catch (err) {
      onDone(errorText(err));
    } finally {
      setPending(false);
    }
  }

  function start() {
    if (kind === "location") {
      void add();
      return;
    }
    const owners = characters.filter((name) => characterOwnsFile(file.name, name));
    const sole = owners.length === 1 ? owners[0] : characters.length === 1 ? characters[0] : "";
    if (sole) {
      void add(sole);
      return;
    }
    setCharacter(owners[0] ?? characters[0] ?? "");
    setChoosing(true);
  }

  if (choosing) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <select
          value={character}
          aria-label={t("lib.pickCharacter")}
          onChange={(event) => setCharacter(event.target.value)}
          className="h-7 rounded-md border border-stone-300 bg-white px-1"
        >
          {characters.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending || !character}
          onClick={() => void add(character)}
          className="rounded-lg bg-stone-800 px-2 py-1 text-white disabled:opacity-50"
        >
          {t("lib.add")}
        </button>
        <button type="button" disabled={pending} onClick={() => setChoosing(false)} className="text-stone-500 underline">
          {t("common.cancel")}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={start}
      title={t(kind === "character" ? "lib.addTitleCharacter" : "lib.addTitleLocation")}
      className="mt-2 rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs text-stone-800 hover:bg-stone-50 disabled:opacity-50"
    >
      {pending ? t("common.copying") : t("lib.add")}
    </button>
  );
}
