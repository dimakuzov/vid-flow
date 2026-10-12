import fs from "fs";
import path from "path";
import type { StageId } from "./constants";
import { listMediaFiles } from "./media";
import { assertSafeSegment, ensureStageDirs, shotDir, shotsDir, stageDir } from "./paths";
import { syncPromptHistory } from "./prompt-history";
import { readShotMeta } from "./shot-meta";
import { readStatusFile, writeStatusFile } from "./status";
import { readStageState, setIdle } from "./stage-state";

/** Ручное действие пользователя снимает показ прошлой ошибки. Идущую операцию не трогает. */
function clearStageError(episodeId: string, shotId: string, stageId: StageId): void {
  if (readStageState(episodeId, shotId, stageId).phase === "error") setIdle(episodeId, shotId, stageId);
}

/** Номер части имени файла, с которой начинается имя персонажа. -1 — имени нет. */
function namePosition(stem: string, token: string): number {
  if (stem === token || stem.startsWith(`${token}_`) || stem.startsWith(`${token}-`)) return 0;
  const segments = stem.split(/[_-]+/).filter(Boolean);
  const parts = token.split(/[_-]+/).filter(Boolean);
  if (!parts.length) return -1;
  return segments.findIndex((_, index) =>
    parts.every((part, offset) => segments[index + offset] === part),
  );
}

/**
 * Персонаж кадра по имени файла. В имени может быть несколько персонажей: `Lena_mom_body.png` —
 * это мама Лены. Тогда сначала тот, кого ещё нет в approve (`taken`), затем тот, чьё имя
 * стоит в имени файла позже (`lena_mom` — мама), затем более длинное имя.
 */
function matchCharacter(filename: string, characters: string[], taken: Set<string> = new Set()): string | null {
  const stem = path.parse(path.basename(filename)).name.toLowerCase();
  const found = characters
    .map((name) => ({ name, at: namePosition(stem, name.toLowerCase()) }))
    .filter((item) => item.at >= 0);
  if (!found.length) return null;
  const free = found.filter((item) => !taken.has(item.name.toLowerCase()));
  const pool = free.length ? free : found;
  pool.sort((a, b) => b.at - a.at || b.name.length - a.name.length);
  return pool[0].name;
}

function characterApproveName(
  filename: string,
  shotId: string,
  characters: string[],
  taken?: Set<string>,
): string | null {
  const parsed = path.parse(path.basename(filename));
  const matched = matchCharacter(filename, characters, taken);
  const character = matched ?? (characters.length === 1 ? characters[0] : null);
  if (!character) {
    if (characters.length) return null;
    const token = parsed.name.split("_")[0];
    if (!token) return null;
    return `${token}_${shotId}${parsed.ext.toLowerCase()}`;
  }
  return `${character}_${shotId}${parsed.ext.toLowerCase()}`;
}

function approveRank(filename: string, shotId: string, characters: string[]): number {
  const stem = path.parse(path.basename(filename)).name.toLowerCase();
  const matched = matchCharacter(filename, characters);
  if (!matched) return 0;
  const token = `${matched}_${shotId}`.toLowerCase();
  if (stem === token || stem.startsWith(`${token}_`)) return 2;
  return 1;
}

function approvedSlot(filename: string, shotId: string): string {
  const stem = path.parse(path.basename(filename)).name;
  const suffix = `_${shotId}`;
  if (stem.toLowerCase().endsWith(suffix.toLowerCase())) {
    return stem.slice(0, stem.length - suffix.length).toLowerCase();
  }
  return (stem.split("_")[0] ?? stem).toLowerCase();
}

function uniqueTarget(dir: string, filename: string): string {
  const parsed = path.parse(filename);
  let candidate = filename;
  let i = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${parsed.name}_${i}${parsed.ext}`;
    i += 1;
  }
  return candidate;
}

/** Пользователь сам менял refs/: агент их не пересобирает (agent_touch.json). */
function markRefsTouched(episodeId: string, shotId: string, stageId: StageId): void {
  fs.writeFileSync(
    path.join(stageDir(episodeId, shotId, stageId), "agent_touch.json"),
    JSON.stringify({ refsTouchedByUser: true, touchedAt: new Date().toISOString() }, null, 2) + "\n",
  );
}

export async function saveUpload(options: {
  episodeId: string;
  shotId: string;
  stageId: StageId;
  target: "refs" | "output";
  filename: string;
  bytes: Buffer;
  approveAfter?: boolean;
}): Promise<{ savedAs: string; approvedAs?: string }> {
  const episodeId = options.episodeId;
  const shotId = assertSafeSegment(options.shotId, "shot");
  ensureStageDirs(episodeId, shotId);
  const dir = path.join(stageDir(episodeId, shotId, options.stageId), options.target);
  fs.mkdirSync(dir, { recursive: true });
  const savedAs = uniqueTarget(dir, path.basename(options.filename));
  fs.writeFileSync(path.join(dir, savedAs), options.bytes);

  if (options.target === "refs") markRefsTouched(episodeId, shotId, options.stageId);

  if (options.approveAfter) {
    const approvedAs = approveFiles({
      episodeId,
      shotId,
      stageId: options.stageId,
      filenames: [savedAs],
      from: options.target === "refs" ? "refs" : "output",
    })[0];
    return { savedAs, approvedAs };
  }

  if (options.target === "output") {
    writeStatusFile(episodeId, shotId, options.stageId, { status: "review" });
    clearStageError(episodeId, shotId, options.stageId);
  }

  return { savedAs };
}

export function approveFiles(options: {
  episodeId: string;
  shotId: string;
  stageId: StageId;
  filenames: string[];
  from?: "output" | "refs";
}): string[] {
  const episodeId = options.episodeId;
  const shotId = assertSafeSegment(options.shotId, "shot");
  ensureStageDirs(episodeId, shotId);
  const stagePath = stageDir(episodeId, shotId, options.stageId);
  const fromDir = path.join(stagePath, options.from || "output");
  const approveDir = path.join(stagePath, "approve");
  fs.mkdirSync(approveDir, { recursive: true });

  if (options.stageId !== "characters") {
    for (const existing of fs.readdirSync(approveDir)) {
      fs.unlinkSync(path.join(approveDir, existing));
    }
  }

  const characters =
    options.stageId === "characters" ? readShotMeta(episodeId, shotId).characters : [];
  const filenames =
    options.stageId === "characters"
      ? [...options.filenames].sort(
          (a, b) =>
            approveRank(a, shotId, characters) - approveRank(b, shotId, characters) ||
            a.localeCompare(b),
        )
      : options.filenames;

  const saved: string[] = [];
  for (const name of filenames) {
    const safeName = path.basename(name);
    const source = path.join(fromDir, safeName);
    if (!fs.existsSync(source)) {
      throw new Error(`Файл не найден в output: ${safeName}`);
    }
    // Кто уже в approve: файл с двумя именами достаётся тому, кого там ещё нет.
    const taken =
      options.stageId === "characters"
        ? new Set(fs.readdirSync(approveDir).map((existing) => approvedSlot(existing, shotId)))
        : undefined;
    const targetName =
      options.stageId === "characters"
        ? characterApproveName(safeName, shotId, characters, taken)
        : safeName;
    if (!targetName) continue;
    if (options.stageId === "characters") {
      const slot = approvedSlot(targetName, shotId);
      for (const existing of fs.readdirSync(approveDir)) {
        if (approvedSlot(existing, shotId) === slot && existing !== targetName) {
          fs.unlinkSync(path.join(approveDir, existing));
        }
      }
    }
    const target = path.join(approveDir, targetName);
    fs.copyFileSync(source, target);
    saved.push(targetName);
  }

  if (!saved.length) {
    const expected = characters.length ? characters.join(", ") : shotId;
    throw new Error(
      `Файл не совпал с персонажем кадра (${expected}). Назовите вариант именем персонажа, например katya.png.`,
    );
  }

  writeStatusFile(episodeId, shotId, options.stageId, { status: "approved" });
  clearStageError(episodeId, shotId, options.stageId);
  return [...new Set(saved)];
}

export function removeApprovedFile(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  filename: string,
): string {
  const safeShot = assertSafeSegment(shotId, "shot");
  const safeName = path.basename(filename);
  if (!safeName || safeName !== filename || safeName === "." || safeName === "..") {
    throw new Error("Некорректное имя файла");
  }
  const approveDir = path.join(stageDir(episodeId, safeShot, stageId), "approve");
  const target = path.join(approveDir, safeName);
  if (!target.startsWith(approveDir + path.sep)) {
    throw new Error("Некорректное имя файла");
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`Файл не найден: ${safeName}`);
  }
  fs.unlinkSync(target);

  const remaining = listMediaFiles(approveDir);
  const output = listMediaFiles(path.join(stageDir(episodeId, safeShot, stageId), "output"));
  const names = stageId === "characters" ? readShotMeta(episodeId, safeShot).characters : [];
  const stillApproved =
    stageId === "characters"
      ? names.length
        ? names.every((name) =>
            remaining.some((file) =>
              file.name.toLowerCase().startsWith(`${name}_${safeShot}`.toLowerCase()),
            ),
          )
        : remaining.length > 0
      : remaining.length > 0;
  if (!stillApproved && readStatusFile(episodeId, safeShot, stageId).status === "approved") {
    writeStatusFile(episodeId, safeShot, stageId, { status: output.length ? "review" : "prep" });
  }
  return safeName;
}

/**
 * Удалить файл из output/ или refs/ этапа насовсем (без корзины). Кнопка на доске —
 * это и есть подтверждение пользователя. approve/ — через removeApprovedFile.
 */
export function deleteStageFile(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  folder: "output" | "refs",
  filename: string,
): string {
  const safeShot = assertSafeSegment(shotId, "shot");
  if (folder !== "output" && folder !== "refs") throw new Error("Удалять можно только из output/ и refs/");
  const safeName = path.basename(filename);
  if (!safeName || safeName !== filename || safeName === "." || safeName === "..") {
    throw new Error("Некорректное имя файла");
  }
  if (folder === "refs" && readStageState(episodeId, safeShot, stageId).busy) {
    throw new Error(
      "Этап занят: граф или агент сейчас читает refs/. Удалить референс можно после прогона или «Отменить».",
    );
  }
  const dir = path.join(stageDir(episodeId, safeShot, stageId), folder);
  const target = path.join(dir, safeName);
  if (!target.startsWith(dir + path.sep)) throw new Error("Некорректное имя файла");
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`Файл не найден в ${folder}/: ${safeName}`);
  }
  fs.unlinkSync(target);

  if (folder === "refs") {
    markRefsTouched(episodeId, safeShot, stageId);
  } else if (
    !listMediaFiles(dir).length &&
    readStatusFile(episodeId, safeShot, stageId).status === "review"
  ) {
    writeStatusFile(episodeId, safeShot, stageId, { status: "prep" });
  }
  return safeName;
}

export function updateStageDocs(options: {
  episodeId: string;
  shotId: string;
  stageId: StageId;
  prompt?: string;
  llmNotes?: string;
  refs?: string;
  workflow?: string;
}): void {
  const episodeId = options.episodeId;
  const shotId = assertSafeSegment(options.shotId, "shot");
  const dir = stageDir(episodeId, shotId, options.stageId);
  fs.mkdirSync(dir, { recursive: true });
  if (typeof options.prompt === "string") {
    syncPromptHistory(episodeId, shotId, options.stageId);
  }
  const mapping: Array<[string | undefined, string]> = [
    [options.prompt, "prompt.md"],
    [options.llmNotes, "llm_notes.md"],
    [options.refs, "refs.md"],
    [options.workflow, "workflow.md"],
  ];
  for (const [value, filename] of mapping) {
    if (typeof value === "string") {
      fs.writeFileSync(path.join(dir, filename), value, "utf8");
    }
  }
  if (typeof options.prompt === "string") {
    syncPromptHistory(episodeId, shotId, options.stageId);
  }
}

export function listApprove(episodeId: string, shotId: string, stageId: StageId) {
  return listMediaFiles(path.join(stageDir(episodeId, shotId, stageId), "approve"));
}

export function deleteShot(episodeId: string, shotId: string): void {
  const id = assertSafeSegment(shotId, "кадр");
  if (!/^s\d+$/i.test(id)) throw new Error("Некорректный кадр");
  const dir = path.resolve(shotDir(episodeId, id));
  const root = path.resolve(shotsDir(episodeId));
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw new Error("Некорректный кадр");
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
