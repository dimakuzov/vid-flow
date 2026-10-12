import fs from "fs";
import path from "path";
import { STAGE_LABELS, STAGES, type StageId } from "./constants";
import { shotDir } from "./paths";

/*
 * Замечания пользователя к кадру: каждое сообщение «Отправить агенту» с любого этапа.
 * Поле «Рекомендация» после отправки очищается, а замечание остаётся здесь, и агент видит
 * всю историю: более позднее замечание важнее раннего, замечания важнее сценария.
 * `shots/{shotId}/notes.json`. Пишет только доска.
 */

export const NOTES_FILE = "notes.json";

export interface ShotNote {
  id: string;
  at: string;
  stageId: StageId;
  message: string;
}

function notesPath(episodeId: string, shotId: string): string {
  return path.join(shotDir(episodeId, shotId), NOTES_FILE);
}

export function readShotNotes(episodeId: string, shotId: string): ShotNote[] {
  try {
    const data = JSON.parse(fs.readFileSync(notesPath(episodeId, shotId), "utf8")) as { entries?: unknown };
    if (!Array.isArray(data.entries)) return [];
    return data.entries.filter(
      (item): item is ShotNote =>
        Boolean(item) &&
        typeof (item as ShotNote).id === "string" &&
        typeof (item as ShotNote).at === "string" &&
        typeof (item as ShotNote).message === "string" &&
        STAGES.includes((item as ShotNote).stageId),
    );
  } catch {
    return [];
  }
}

function writeShotNotes(episodeId: string, shotId: string, entries: ShotNote[]): void {
  const file = notesPath(episodeId, shotId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ entries }, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export function appendShotNote(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  message: string,
  at = new Date().toISOString(),
): ShotNote | null {
  const text = message.trim();
  if (!text) return null;
  const note: ShotNote = { id: `${stageId}-${Date.parse(at) || Date.now()}`, at, stageId, message: text };
  writeShotNotes(episodeId, shotId, [...readShotNotes(episodeId, shotId), note]);
  return note;
}

/** Убрать замечание (кнопка на странице этапа). false — такого нет. */
export function deleteShotNote(episodeId: string, shotId: string, id: string): boolean {
  const entries = readShotNotes(episodeId, shotId);
  const next = entries.filter((item) => item.id !== id);
  if (next.length === entries.length) return false;
  writeShotNotes(episodeId, shotId, next);
  return true;
}

/** Замечания до момента `before` (текущее сообщение агент видит отдельно). */
export function notesBefore(episodeId: string, shotId: string, before?: string): ShotNote[] {
  const entries = readShotNotes(episodeId, shotId);
  return before ? entries.filter((item) => item.at < before) : entries;
}

/** Строки «1. [Первый кадр, 2026-10-10 17:30] текст» для задачи агенту. */
export function noteLines(notes: ShotNote[]): string[] {
  return notes.map(
    (note, index) =>
      `${index + 1}. [${STAGE_LABELS[note.stageId]}, ${note.at.slice(0, 16).replace("T", " ")}] ${note.message.replace(/\s*\n\s*/g, " / ")}`,
  );
}
