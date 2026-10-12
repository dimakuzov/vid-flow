import crypto from "crypto";
import fs from "fs";
import path from "path";
import { claudeOneShot, claudeOneShotAvailable } from "../agent/claude-oneshot";
import { ensureShotDescriptions, shotDescriptions, type ShotDescription } from "./descriptions";
import { readTextIfExists } from "./media";
import { listShotIds, shotDir } from "./paths";
import { readShotMeta } from "./shot-meta";
import { noteLines, readShotNotes, type ShotNote } from "./shot-notes";
import { readShotSpeech } from "./speech";

/*
 * Действие кадра, приведённое к утверждённым картинкам (`shots/{shotId}/action.md`): сценарий
 * писали до картинок, а агенту нужно действие, которое можно снять в этой локации с этими
 * персонажами. Пересобирается, когда меняется основа: картинки (их описания), действие в shot.md
 * или замечания пользователя. Правка пользователя на странице этапа сохраняется и важнее модели.
 * `action.json` рядом — основа и чья версия. Пишет только доска.
 */

export const ACTION_FILE = "action.md";
const ACTION_META = "action.json";

interface ActionMeta {
  /** Хэш основы, по которой действие написано (или сохранено пользователем). */
  basis: string;
  /** sha256 текста action.md, который записала доска: другой текст — правка руками. */
  textSha: string;
  source: "agent" | "user";
  at: string;
  model?: string;
}

function sha(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function actionPath(episodeId: string, shotId: string): string {
  return path.join(shotDir(episodeId, shotId), ACTION_FILE);
}

function metaPath(episodeId: string, shotId: string): string {
  return path.join(shotDir(episodeId, shotId), ACTION_META);
}

function readMeta(episodeId: string, shotId: string): ActionMeta | null {
  try {
    return JSON.parse(fs.readFileSync(metaPath(episodeId, shotId), "utf8")) as ActionMeta;
  } catch {
    return null;
  }
}

function writeAction(episodeId: string, shotId: string, text: string, meta: Omit<ActionMeta, "textSha">): void {
  const body = `${text.trim()}\n`;
  fs.writeFileSync(actionPath(episodeId, shotId), body, "utf8");
  fs.writeFileSync(
    metaPath(episodeId, shotId),
    JSON.stringify({ ...meta, textSha: sha(body) }, null, 2) + "\n",
    "utf8",
  );
}

export function readShotAction(episodeId: string, shotId: string): string {
  return readTextIfExists(actionPath(episodeId, shotId)).trim();
}

/** Текст action.md правил пользователь (на странице или руками в файле). */
export function actionEditedByUser(episodeId: string, shotId: string): boolean {
  const meta = readMeta(episodeId, shotId);
  const text = readTextIfExists(actionPath(episodeId, shotId));
  if (!text.trim()) return false;
  if (!meta) return true;
  return meta.source === "user" || meta.textSha !== sha(text);
}

/** Основа действия: shot.md, какие картинки утверждены и описаны ли они, замечания. */
export function actionBasis(episodeId: string, shotId: string, descriptions = shotDescriptions(episodeId, shotId)): string {
  const meta = readShotMeta(episodeId, shotId);
  return sha(
    JSON.stringify({
      title: meta.title,
      summary: meta.summary,
      images: descriptions.map((item) => [item.image.kind, item.image.subject, item.sha256, Boolean(item.description)]),
      notes: readShotNotes(episodeId, shotId).map((note) => note.id),
    }),
  );
}

/** «Сохранить» действия на странице этапа: версия пользователя, пока основа не изменится. */
export function saveUserAction(episodeId: string, shotId: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) {
    fs.rmSync(actionPath(episodeId, shotId), { force: true });
    fs.rmSync(metaPath(episodeId, shotId), { force: true });
    return;
  }
  writeAction(episodeId, shotId, trimmed, {
    basis: actionBasis(episodeId, shotId),
    source: "user",
    at: new Date().toISOString(),
  });
}

/** Действие устарело: основа изменилась с тех пор, как его написали. */
export function actionStale(episodeId: string, shotId: string): boolean {
  const meta = readMeta(episodeId, shotId);
  if (!meta || !readShotAction(episodeId, shotId)) return true;
  return meta.basis !== actionBasis(episodeId, shotId);
}

// ---------- задание модели ----------

export const ACTION_RULES = `You adapt the action of one shot of a film to the pictures that were actually approved for it. Your text is the staging that the image prompt and the video prompt will follow.

Priority, highest first:
1. The user's notes. A later note wins over an earlier one. A note that changes the story (who stands where, which way someone faces, what happens) changes the action, even against the scenario. If a later note undoes an earlier one, follow the later one. The user's own version of the action counts as a note written at its time.
2. The approved pictures. The location stays exactly as it is: the action happens in the part of the place that is visible, with what is visible. The characters look exactly as on their references. If a first frame is approved, the action starts from exactly that frame: the same positions, facing and poses.
3. The scenario text of this shot: keep its meaning (what happens, the emotion, the story beat) as far as the pictures allow.
4. The previous shots: only to understand where people came from and the mood. They never override this shot.

How to adapt:
- Remove from the action what the location does not have and cannot show. If the scenario says she runs up the stairs but no stairs are visible, she does not climb stairs in the frame.
- But read the location as a part of the place the scenario names. A small space with one window and mailboxes, in a shot the scenario calls a stairwell, is a landing of that stairwell: a person can come from just above or just below, out of the frame, even if no steps are visible.
- Put every person where people naturally are in such a place: on the sidewalk, not on the road where cars drive; on the floor of the landing, not on the window sill. Use what the location description says about where a person can stand or walk.
- Respect the camera of the location. If the location looks along a passage that leads away from the camera, a person walks away from the camera with their back to us, even if the scenario says they walk towards us. Keep the story meaning: she hurries away into the dark instead of towards us.
- Never describe clothes, hair or items, and never take them from the scenario: the references show them. If the scenario's clothes differ from the reference, drop them.
- Do not add people, objects, weather or light that the pictures do not have, unless a user note asks for it.
- Do not invent movements, gestures or emotions that neither the scenario nor the notes give.
- Describe only the staging: positions, which way people face and look, what they do, from where they come. Name a place landmark only when a position needs it (at the window, by the railing). Do not describe the light, the colours or the look of the place.
- Do not mention image numbers, files, prompts or camera technique.

Write the result in Russian only, with no English words: one paragraph, 2 to 5 sentences, present tense. Name the characters by their names. Reply with the paragraph only.`;

function describedLines(descriptions: ShotDescription[]): string[] {
  const lines: string[] = [];
  for (const item of descriptions) {
    const text = item.description?.text ?? "(not described yet)";
    if (item.image.kind === "location") lines.push(`### Location (the fixed background)\n\n${text}`);
    else if (item.image.kind === "character") lines.push(`### Character: ${item.image.subject}\n\n${text}`);
    else lines.push(`### Approved first frame (the video starts from it)\n\n${text}`);
  }
  return lines;
}

function previousShots(episodeId: string, shotId: string, count = 2): string[] {
  const ids = listShotIds(episodeId);
  const at = ids.indexOf(shotId);
  if (at <= 0) return [];
  return ids.slice(Math.max(0, at - count), at).map((id) => {
    const meta = readShotMeta(episodeId, id);
    const action = readShotAction(episodeId, id);
    return `### ${id}: ${meta.title}\n\n${action || meta.summary || "(no action text)"}`;
  });
}

export function buildActionTask(
  episodeId: string,
  shotId: string,
  descriptions: ShotDescription[],
  notes: ShotNote[],
  userVersion: { text: string; at: string } | null,
): string {
  const meta = readShotMeta(episodeId, shotId);
  const speech = readShotSpeech(episodeId, shotId).trim();
  const previous = previousShots(episodeId, shotId);
  const parts = [
    ACTION_RULES,
    "",
    `## Scenario text of shot ${shotId}: ${meta.title} (written before the pictures existed)`,
    "",
    meta.summary || "(no action text)",
    "",
    `- characters: ${meta.characters.join(", ") || "(none)"}`,
    `- location: ${meta.location || "(none)"}`,
  ];
  if (speech) parts.push("", "## Lines spoken in this shot", "", speech);
  parts.push("", "## What the approved pictures actually show", "", ...describedLines(descriptions));
  if (userVersion) {
    parts.push("", `## The user's own version of the action (${userVersion.at.slice(0, 16).replace("T", " ")})`, "", userVersion.text);
  }
  parts.push("", "## The user's notes for this shot, oldest first", "", ...(notes.length ? noteLines(notes) : ["(none)"]));
  if (previous.length) {
    parts.push("", "## Previous shots (background only, lowest priority)", "", ...previous);
  }
  parts.push("", "Write the adapted action of this shot.");
  return parts.join("\n") + "\n";
}

const INFLIGHT_KEY = "__frameboardShotActions";

function inflight(): Map<string, Promise<string>> {
  const g = globalThis as typeof globalThis & { [INFLIGHT_KEY]?: Map<string, Promise<string>> };
  if (!g[INFLIGHT_KEY]) g[INFLIGHT_KEY] = new Map();
  return g[INFLIGHT_KEY]!;
}

/**
 * Действие кадра для задачи агенту: сначала описания картинок, затем action.md, если основа
 * изменилась. Нет утверждённых картинок — действие не нужно (вернёт то, что есть).
 * Ошибка модели — остаётся прошлое действие.
 */
export async function ensureShotAction(episodeId: string, shotId: string, signal: AbortSignal): Promise<string> {
  const key = `${episodeId}/${shotId}`;
  const running = inflight().get(key);
  if (running) return running;
  const work = (async () => {
    const descriptions = await ensureShotDescriptions(episodeId, shotId, signal);
    const current = readShotAction(episodeId, shotId);
    if (!descriptions.some((item) => item.description)) return current;
    const basis = actionBasis(episodeId, shotId, descriptions);
    const meta = readMeta(episodeId, shotId);
    if (current && meta?.basis === basis) return current;
    if (!claudeOneShotAvailable()) return current;
    const edited = actionEditedByUser(episodeId, shotId);
    const userVersion = edited && current
      ? { text: current, at: meta?.source === "user" ? meta.at : fs.statSync(actionPath(episodeId, shotId)).mtime.toISOString() }
      : null;
    const task = buildActionTask(episodeId, shotId, descriptions, readShotNotes(episodeId, shotId), userVersion);
    try {
      const result = await claudeOneShot({ prompt: task, signal });
      const text = result.text.replace(/^```[^\n]*\n?|\n?```$/g, "").trim();
      if (!text) return current;
      writeAction(episodeId, shotId, text, { basis, source: "agent", at: new Date().toISOString(), model: result.model });
      return text;
    } catch (error) {
      if (!signal.aborted) console.warn("[frameboard] действие кадра:", shotId, error instanceof Error ? error.message : error);
      return current;
    }
  })().finally(() => inflight().delete(key));
  inflight().set(key, work);
  return work;
}
