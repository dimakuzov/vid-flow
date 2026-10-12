"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RefSourceGroup } from "@/lib/series/ref-sources";
import type { StageDetail } from "@/lib/series/types";
import { errorText, requestJson } from "./api";

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
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<RefSourceGroup[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    requestJson<{ groups: RefSourceGroup[] }>(`${stageApi}/ref-sources`, {
      fallbackError: "Не удалось прочитать источники",
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
  }, [open, stageApi]);

  function toggle(filePath: string) {
    setPicked((current) =>
      current.includes(filePath) ? current.filter((item) => item !== filePath) : [...current, filePath],
    );
  }

  async function add() {
    setPending(true);
    setError("");
    try {
      const data = await requestJson<{ message: string; stage: StageDetail }>(`${stageApi}/ref-sources`, {
        method: "POST",
        body: { paths: picked },
        fallbackError: "Не удалось добавить референс",
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
        Добавить референс из…
      </Button>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-4 sm:items-center" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Добавить референс"
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-4 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-stone-900">Добавить референс из…</h2>
            <p className="mt-1 text-xs text-stone-500">
              Файл копируется в refs/. Исходник остаётся на месте. Можно выбрать несколько.
            </p>
            {groups === null && !error ? <p className="mt-3 text-sm text-stone-500">Загрузка…</p> : null}
            {groups?.length === 0 ? <p className="mt-3 text-sm text-stone-500">Нечего добавить.</p> : null}
            <div className="mt-3 space-y-4">
              {groups?.map((group) => (
                <section key={group.id}>
                  <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-stone-500">{group.title}</h3>
                  <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {group.files.map((file) => {
                      const on = picked.includes(file.path);
                      return (
                        <li key={file.path}>
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggle(file.path)}
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
                              {on ? "Выбрано · " : ""}
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
                {pending ? "Копирую…" : `Добавить выбранные${picked.length ? ` (${picked.length})` : ""}`}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                Закрыть
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
