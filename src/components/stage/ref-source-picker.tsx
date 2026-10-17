"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/language";
import { Button } from "@/components/ui/button";
import { stageName, type Translate } from "@/lib/i18n";
import type { RefSourceGroup } from "@/lib/series/ref-sources";
import type { StageDetail } from "@/lib/series/types";
import { errorText, requestJson } from "./api";

function groupTitle(group: RefSourceGroup, tr: Translate): string {
  if (group.id === "characters-shot") return tr("source.group.charactersShot");
  if (group.id === "characters-rest") return tr("source.group.charactersRest");
  if (group.id === "locations") return tr("source.group.locations");
  if (group.id === "references") return tr("source.group.shared");
  if (group.id === "other-shots") return tr("source.group.other");
  if (group.id.startsWith("stage-")) return tr("source.group.stage", { stage: stageName(tr, group.id.slice("stage-".length)) });
  return group.title;
}

/**
 * «Добавить референс из…»: сетка источников, несколько файлов копируются в refs/.
 */
export function RefSourcePicker({
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
  const [groups, setGroups] = useState<RefSourceGroup[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    requestJson<{ groups: RefSourceGroup[] }>(`${stageApi}/ref-sources`, {
      fallbackError: t("source.readFailed"),
    })
      .then((data) => {
        if (!stopped) setGroups(data.groups);
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

  function toggle(filePath: string) {
    setPicked((current) =>
      current.includes(filePath) ? current.filter((item) => item !== filePath) : [...current, filePath],
    );
  }

  async function add(paths = picked) {
    if (!paths.length || pending) return;
    setPending(true);
    setError("");
    try {
      const data = await requestJson<{ message: string; stage: StageDetail }>(`${stageApi}/ref-sources`, {
        method: "POST",
        body: { paths },
        fallbackError: t("source.addFailed"),
      });
      setOpen(false);
      onPicked(data.stage, data.message);
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
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setGroups(null);
          setPicked([]);
          setError("");
          setOpen((value) => !value);
        }}
      >
        {t("source.button")}
      </Button>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-4 sm:items-center" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("source.label")}
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-4 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-stone-900">{t("source.button")}</h2>
            <p className="mt-1 text-xs text-stone-500">{t("source.lead")}</p>
            {groups === null && !error ? <p className="mt-3 text-sm text-stone-500">{t("common.loading")}</p> : null}
            {groups?.length === 0 ? <p className="mt-3 text-sm text-stone-500">{t("source.empty")}</p> : null}
            <div className="mt-3 space-y-4">
              {groups?.map((group) => (
                <section key={group.id}>
                  <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-stone-500">{groupTitle(group, t)}</h3>
                  <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {group.files.map((file) => {
                      const on = picked.includes(file.path);
                      return (
                        <li key={file.path}>
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggle(file.path)}
                            onDoubleClick={() => void add([file.path])}
                            className={`grid w-full gap-1 rounded-md border p-1 text-left text-xs ${
                              on ? "border-teal-700 bg-teal-50" : "border-transparent hover:bg-stone-100"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- превью из /api/media */}
                            <img
                              src={`/api/media/${file.path.split("/").map(encodeURIComponent).join("/")}`}
                              alt=""
                              className="aspect-square w-full rounded object-cover"
                            />
                            <span className="truncate" title={file.label}>
                              {on ? t("common.selected") : ""}
                              {file.label}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
            {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" disabled={pending || picked.length === 0} onClick={() => void add()}>
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
