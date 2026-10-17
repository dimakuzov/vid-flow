"use client";

import { useState } from "react";
import { useT } from "@/components/language";
import { Button } from "@/components/ui/button";
import { stageName } from "@/lib/i18n";
import type { StageDetail } from "@/lib/series/types";

function time(at: string): string {
  return at.slice(0, 16).replace("T", " ");
}

/**
 * Действие кадра из сценария, действие под утверждённые картинки (можно поправить),
 * что модель увидела на картинках и история замечаний к кадру.
 */
export function ShotContext({
  detail,
  disabled,
  onSaveAction,
  onDeleteNote,
}: {
  detail: StageDetail;
  disabled: boolean;
  onSaveAction: (text: string) => void;
  onDeleteNote: (id: string) => void;
}) {
  // Старый сервер (до перезапуска) этих полей не отдаёт.
  const context = detail.shotContext ?? null;
  const notes = detail.notes ?? [];
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const scenario = detail.shotSummary.trim();
  const action = context?.action.trim() ?? "";
  const showAction = editing !== null || Boolean(context && (action || !scenario));

  return (
    <div className="space-y-2">
      {showAction && context ? (
        <div className="rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium text-teal-900">
              {t("context.action")}
              {context.actionEditedByUser ? t("context.edited") : ""}
              {context.action && context.actionStale ? t("context.stale") : ""}
            </div>
            {editing === null ? (
              <button
                type="button"
                className="text-xs text-teal-800 hover:underline disabled:opacity-50"
                disabled={disabled}
                onClick={() => setEditing(context.action)}
              >
                {context.action ? t("context.change") : t("context.write")}
              </button>
            ) : null}
          </div>
          {editing !== null ? (
            <div className="mt-2 space-y-2">
              <textarea
                className="min-h-24 w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm"
                value={editing}
                onChange={(event) => setEditing(event.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    onSaveAction(editing);
                    setEditing(null);
                  }}
                >
                  {t("common.save")}
                </Button>
                <Button size="sm" variant="outline" disabled={disabled} onClick={() => setEditing(null)}>
                  {t("common.cancel")}
                </Button>
              </div>
              <p className="text-xs text-stone-500">{t("context.yours")}</p>
            </div>
          ) : context.action ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-stone-800">{context.action}</p>
          ) : (
            <p className="mt-1 text-xs text-stone-500">
              {t("context.empty")}
            </p>
          )}
        </div>
      ) : scenario ? (
        <div className="rounded-lg bg-stone-50 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium text-stone-600">{t("context.scenario")}</div>
            {context ? (
              <button
                type="button"
                className="text-xs text-teal-800 hover:underline disabled:opacity-50"
                disabled={disabled}
                onClick={() => setEditing("")}
              >
                {t("context.writeOwn")}
              </button>
            ) : null}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{scenario}</p>
        </div>
      ) : null}

      {notes.length ? (
        <details className="text-xs text-stone-500">
          <summary className="cursor-pointer">{t("context.notes", { n: notes.length })}</summary>
          <ol className="mt-2 space-y-1">
            {notes.map((note) => (
              <li key={note.id} className="flex items-start gap-2 rounded-lg bg-stone-50 px-3 py-1.5">
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-stone-700">
                  <span className="text-stone-500">
                    {stageName(t, note.stageId)} · {time(note.at)}:
                  </span>{" "}
                  {note.message}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-stone-400 hover:text-red-700 disabled:opacity-50"
                  title={t("context.removeNote")}
                  disabled={disabled}
                  onClick={() => onDeleteNote(note.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-1">{t("context.notesRank")}</p>
        </details>
      ) : null}

      {context?.images.length ? (
        <details className="text-xs text-stone-500">
          <summary className="cursor-pointer">
            {t("context.images", {
              done: context.images.filter((item) => item.text).length,
              total: context.images.length,
            })}
          </summary>
          <ul className="mt-2 space-y-2">
            {context.images.map((item) => (
              <li key={`${item.kind}-${item.name}`} className="rounded-lg bg-stone-50 px-3 py-2">
                <div className="font-medium text-stone-600">
                  {t(
                    item.kind === "location"
                      ? "context.kind.location"
                      : item.kind === "character"
                        ? "context.kind.character"
                        : "context.kind.first_frame",
                  )}
                  {item.subject ? ` ${item.subject}` : ""} · <code>{item.name}</code>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-stone-700">
                  {item.text ?? (item.describing ? t("context.describing") : t("context.undescribed"))}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
