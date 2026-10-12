import type { StageId } from "../series/constants";
import { shotDescriptions, stageUsesContext } from "../series/descriptions";
import { readShotAction } from "../series/shot-action";
import { noteLines, notesBefore } from "../series/shot-notes";

/*
 * Что агент этапа знает о кадре сверх shot.md: замечания пользователя по всем этапам,
 * действие кадра под утверждённые картинки (action.md) и что на этих картинках на самом деле.
 * Один текст и для text-режима, и для llm_task.md: агент пишет промпт на английском.
 */

export const PRIORITY_RULES = `Priority, highest first: the user's request; the user's earlier notes for this shot (a later note wins over an earlier one); what the approved pictures actually show; the shot action adapted to the pictures (action.md); the original scenario text in shot.md; anything else. When shot.md says something the pictures or the notes contradict (clothes, hair, stairs that are not there, which way someone faces), drop it. Notes from another stage count when they are about the story, the people, their clothes and items, or the place; technical notes about another stage's result (size, another try) do not.`;

/**
 * Разделы о кадре для задачи агенту. `before` — время текущего запроса: его сообщение агент
 * видит отдельно, здесь только более ранние замечания.
 */
export function renderShotContext(episodeId: string, shotId: string, stageId: StageId, before?: string): string {
  const parts: string[] = [];
  if (stageUsesContext(stageId)) {
    const action = readShotAction(episodeId, shotId);
    if (action) {
      parts.push(
        "## Shot action adapted to the approved pictures (action.md)",
        "",
        action,
        "",
        "Stage the shot by this action rather than by the raw scenario text where they differ. It is written in Russian; the prompt stays in the model's language.",
      );
    }
    const described = shotDescriptions(episodeId, shotId).filter(
      // На первом кадре его прошлый утверждённый вариант не нужен: собираем заново из локации и персонажей.
      (item) => item.description && !(stageId === "first_frame" && item.image.kind === "first_frame"),
    );
    if (described.length) {
      parts.push("", "## What the approved pictures actually show", "");
      for (const item of described) {
        const title =
          item.image.kind === "location"
            ? "Location (image 1 of the first frame graph; it stays exactly as it is)"
            : item.image.kind === "character"
              ? `Character ${item.image.subject} (reference: clothes, hair and items exactly as here)`
              : "Approved first frame (the video starts from exactly this frame)";
        parts.push(`### ${title}`, "", item.description!.text, "");
      }
      parts.pop();
    }
  }
  const notes = notesBefore(episodeId, shotId, before);
  if (notes.length) {
    parts.push(
      "",
      "## The user's earlier notes for this shot (oldest first, all stages)",
      "",
      ...noteLines(notes),
      "",
      "These are corrections the user already made. Keep following them unless a later note or the request says otherwise.",
    );
  }
  if (!parts.length) return "";
  return [...parts, "", PRIORITY_RULES].join("\n").replace(/^\n+/, "");
}
