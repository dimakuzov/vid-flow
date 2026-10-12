"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { StageDetail } from "@/lib/series/types";

const KIND_LABELS = {
  location: "Локация",
  character: "Персонаж",
  first_frame: "Первый кадр",
} as const;

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
              Действие кадра
              {context.actionEditedByUser ? " · ваша правка" : ""}
              {context.action && context.actionStale ? " · обновится при следующей отправке агенту" : ""}
            </div>
            {editing === null ? (
              <button
                type="button"
                className="text-xs text-teal-800 hover:underline disabled:opacity-50"
                disabled={disabled}
                onClick={() => setEditing(context.action)}
              >
                {context.action ? "Изменить" : "Написать"}
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
                  Сохранить
                </Button>
                <Button size="sm" variant="outline" disabled={disabled} onClick={() => setEditing(null)}>
                  Отмена
                </Button>
              </div>
              <p className="text-xs text-stone-500">
                Ваша версия важнее модели. Пустой текст — агент напишет действие заново.
              </p>
            </div>
          ) : context.action ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-stone-800">{context.action}</p>
          ) : (
            <p className="mt-1 text-xs text-stone-500">
              Агент напишет его при отправке: сверит сценарий с утверждёнными локацией и персонажами.
            </p>
          )}
        </div>
      ) : scenario ? (
        <div className="rounded-lg bg-stone-50 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium text-stone-600">Описание из сценария</div>
            {context ? (
              <button
                type="button"
                className="text-xs text-teal-800 hover:underline disabled:opacity-50"
                disabled={disabled}
                onClick={() => setEditing("")}
              >
                Написать своё
              </button>
            ) : null}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{scenario}</p>
        </div>
      ) : null}

      {notes.length ? (
        <details className="text-xs text-stone-500">
          <summary className="cursor-pointer">Замечания к кадру ({notes.length}) · агент помнит их все</summary>
          <ol className="mt-2 space-y-1">
            {notes.map((note) => (
              <li key={note.id} className="flex items-start gap-2 rounded-lg bg-stone-50 px-3 py-1.5">
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-stone-700">
                  <span className="text-stone-500">
                    {note.stageLabel} · {time(note.at)}:
                  </span>{" "}
                  {note.message}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-stone-400 hover:text-red-700 disabled:opacity-50"
                  title="Убрать замечание: агент его больше не увидит"
                  disabled={disabled}
                  onClick={() => onDeleteNote(note.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-1">Более позднее замечание важнее раннего. Замечания важнее сценария.</p>
        </details>
      ) : null}

      {context?.images.length ? (
        <details className="text-xs text-stone-500">
          <summary className="cursor-pointer">
            Что на утверждённых картинках ({context.images.filter((item) => item.text).length} из{" "}
            {context.images.length} описано)
          </summary>
          <ul className="mt-2 space-y-2">
            {context.images.map((item) => (
              <li key={`${item.kind}-${item.name}`} className="rounded-lg bg-stone-50 px-3 py-2">
                <div className="font-medium text-stone-600">
                  {KIND_LABELS[item.kind]}
                  {item.subject ? ` ${item.subject}` : ""} · <code>{item.name}</code>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-stone-700">
                  {item.text ?? (item.describing ? "Модель смотрит картинку…" : "Ещё не описано: опишется само в течение минуты или при отправке агенту.")}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
