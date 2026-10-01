import fs from "fs";
import path from "path";
import type { StageId } from "./constants";
import { listMediaFiles } from "./media";
import { assertSafeSegment, ensureStageDirs, shotDir, shotsDir, stageDir } from "./paths";
import { syncPromptHistory } from "./prompt-history";
import { readShotMeta } from "./shot-meta";
import { readStatusFile, writeStatusFile } from "./status";

function matchCharacter(filename: string, characters: string[]): string | null {
  const stem = path.parse(path.basename(filename)).name.toLowerCase();
  const ranked = [...characters].sort((a, b) => b.length - a.length);
  return (
    ranked.find((name) => {
      const token = name.toLowerCase();
      return stem === token || stem.startsWith(`${token}_`) || stem.startsWith(`${token}-`);
    }) ?? null
  );
}

function characterApproveName(
  filename: string,
  shotId: string,
  characters: string[],
): string | null {
  const parsed = path.parse(path.basename(filename));
  const matched = matchCharacter(filename, characters);
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

export async function saveUpload(options: {
  shotId: string;
  stageId: StageId;
  target: "refs" | "output";
  filename: string;
  bytes: Buffer;
  approveAfter?: boolean;
}): Promise<{ savedAs: string; approvedAs?: string }> {
  const shotId = assertSafeSegment(options.shotId, "shot");
  ensureStageDirs(shotId);
  const dir = path.join(stageDir(shotId, options.stageId), options.target);
  fs.mkdirSync(dir, { recursive: true });
  const savedAs = uniqueTarget(dir, path.basename(options.filename));
  fs.writeFileSync(path.join(dir, savedAs), options.bytes);

  if (options.target === "refs") {
    fs.writeFileSync(
      path.join(stageDir(shotId, options.stageId), "agent_touch.json"),
      JSON.stringify(
        { refsTouchedByUser: true, touchedAt: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );
  }

  if (options.approveAfter) {
    const approvedAs = approveFiles({
      shotId,
      stageId: options.stageId,
      filenames: [savedAs],
      from: options.target === "refs" ? "refs" : "output",
    })[0];
    return { savedAs, approvedAs };
  }

  if (options.target === "output") {
    writeStatusFile(shotId, options.stageId, { status: "review" });
  }

  return { savedAs };
}

export function approveFiles(options: {
  shotId: string;
  stageId: StageId;
  filenames: string[];
  from?: "output" | "refs";
}): string[] {
  const shotId = assertSafeSegment(options.shotId, "shot");
  ensureStageDirs(shotId);
  const stagePath = stageDir(shotId, options.stageId);
  const fromDir = path.join(stagePath, options.from || "output");
  const approveDir = path.join(stagePath, "approve");
  fs.mkdirSync(approveDir, { recursive: true });

  if (options.stageId !== "characters") {
    for (const existing of fs.readdirSync(approveDir)) {
      fs.unlinkSync(path.join(approveDir, existing));
    }
  }

  const characters =
    options.stageId === "characters" ? readShotMeta(shotId).characters : [];
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
    const targetName =
      options.stageId === "characters"
        ? characterApproveName(safeName, shotId, characters)
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

  writeStatusFile(shotId, options.stageId, { status: "approved" });
  return [...new Set(saved)];
}

export function removeApprovedFile(shotId: string, stageId: StageId, filename: string): string {
  const safeShot = assertSafeSegment(shotId, "shot");
  const safeName = path.basename(filename);
  if (!safeName || safeName !== filename || safeName === "." || safeName === "..") {
    throw new Error("Некорректное имя файла");
  }
  const approveDir = path.join(stageDir(safeShot, stageId), "approve");
  const target = path.join(approveDir, safeName);
  if (!target.startsWith(approveDir + path.sep)) {
    throw new Error("Некорректное имя файла");
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`Файл не найден: ${safeName}`);
  }
  fs.unlinkSync(target);

  const remaining = listMediaFiles(approveDir);
  const output = listMediaFiles(path.join(stageDir(safeShot, stageId), "output"));
  const names = stageId === "characters" ? readShotMeta(safeShot).characters : [];
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
  if (!stillApproved && readStatusFile(safeShot, stageId).status === "approved") {
    writeStatusFile(safeShot, stageId, { status: output.length ? "review" : "prep" });
  }
  return safeName;
}

export function setWaiting(shotId: string, stageId: StageId): void {
  writeStatusFile(assertSafeSegment(shotId, "shot"), stageId, {
    status: "waiting",
  });
}

export function updateStageDocs(options: {
  shotId: string;
  stageId: StageId;
  prompt?: string;
  llmNotes?: string;
  refs?: string;
  workflow?: string;
}): void {
  const shotId = assertSafeSegment(options.shotId, "shot");
  const dir = stageDir(shotId, options.stageId);
  fs.mkdirSync(dir, { recursive: true });
  if (typeof options.prompt === "string") {
    syncPromptHistory(shotId, options.stageId);
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
    syncPromptHistory(shotId, options.stageId);
  }
}

export function listApprove(shotId: string, stageId: StageId) {
  return listMediaFiles(path.join(stageDir(shotId, stageId), "approve"));
}

export function deleteShot(shotId: string): void {
  const id = assertSafeSegment(shotId, "кадр");
  if (!/^s\d+$/i.test(id)) throw new Error("Некорректный кадр");
  const dir = path.resolve(shotDir(id));
  const root = path.resolve(shotsDir());
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw new Error("Некорректный кадр");
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
