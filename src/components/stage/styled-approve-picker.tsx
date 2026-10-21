"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/language";
import { Button } from "@/components/ui/button";
import type { StyledFile } from "@/lib/series/library-add";
import type { StageDetail } from "@/lib/series/types";
import { errorText, requestJson } from "./api";

/**
 * «Add from character library»: одетые картинки персонажей кадра из `styled/` копируются в approve/.
 */
export function StyledApprovePicker({
  stageApi,
  disabled,
  onDone,
}: {
  stageApi: string;
  disabled?: boolean;
  onDone: (stage: StageDetail, message: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<StyledFile[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    requestJson<{ files: StyledFile[] }>(`${stageApi}/styled-approve`, { fallbackError: t("styled.readFailed") })
      .then((data) => {
        if (!stopped) setFiles(data.files);
      })
      .catch((err) => {
        if (!stopped) setError(errorText(err));
      });
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      stopped = true;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, stageApi, t]);

  async function add() {
    setPending(true);
    setError("");
    try {
      const data = await requestJson<{ savedAs: string[]; stage: StageDetail }>(`${stageApi}/styled-approve`, {
        method: "POST",
        body: { paths: picked },
        fallbackError: t("styled.addFailed"),
      });
      setOpen(false);
      onDone(data.stage, t("styled.added", { names: data.savedAs.join(", ") }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={disabled || pending}
        aria-haspopup="dialog"
        onClick={() => {
          setFiles(null);
          setPicked([]);
          setError("");
          setOpen(true);
        }}
      >
        {t("styled.button")}
      </Button>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-4 sm:items-center" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("styled.button")}
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-4 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-stone-900">{t("styled.button")}</h2>
            <p className="mt-1 text-xs text-stone-500">{t("styled.lead")}</p>
            {files === null && !error ? <p className="mt-3 text-sm text-stone-500">{t("common.loading")}</p> : null}
            {files && !files.length ? <p className="mt-3 text-sm text-stone-500">{t("styled.empty")}</p> : null}
            {files?.length ? (
              <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {files.map((file) => {
                  const on = picked.includes(file.path);
                  return (
                    <li key={file.path}>
                      <button
                        type="button"
                        aria-pressed={on}
                        className={`w-full rounded-lg border p-2 text-left text-xs ${on ? "border-teal-700 bg-teal-50" : "border-stone-200"}`}
                        onClick={() =>
                          setPicked((current) =>
                            current.includes(file.path) ? current.filter((item) => item !== file.path) : [...current, file.path],
                          )
                        }
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- миниатюра из /api/media */}
                        <img
                          src={`/api/media/${file.path.split("/").map(encodeURIComponent).join("/")}`}
                          alt=""
                          className="mb-1 aspect-[3/4] w-full rounded bg-stone-100 object-contain"
                        />
                        {on ? t("common.selected") : ""}
                        {file.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
            <div className="mt-4 flex gap-2">
              <Button type="button" disabled={pending || !picked.length} onClick={() => void add()}>
                {pending ? t("common.copying") : picked.length ? t("source.addN", { n: picked.length }) : t("source.add")}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                {t("common.close")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
