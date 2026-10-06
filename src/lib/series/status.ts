import fs from "fs";
import path from "path";
import type { StageId, StageStatus } from "./constants";
import { listMediaFiles, readTextIfExists } from "./media";
import { stageDir } from "./paths";
import { readStageState } from "./stage-state";

/**
 * status.json хранит ожидаемых персонажей и заметку. Поле `status` в нём только
 * информационное (последнее, что записала доска); статус клетки считает deriveStageStatus.
 */
export interface StatusFile {
  status?: StageStatus | "done" | "waiting";
  expectedCharacters?: string[];
  updatedAt?: string;
  notes?: string;
}

export function readStatusFile(episodeId: string, shotId: string, stageId: StageId): StatusFile {
  const file = path.join(stageDir(episodeId, shotId, stageId), "status.json");
  const raw = readTextIfExists(file);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as StatusFile;
  } catch {
    return {};
  }
}

export function writeStatusFile(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  data: StatusFile,
): void {
  const file = path.join(stageDir(episodeId, shotId, stageId), "status.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

export function expectedApproveCount(
  stageId: StageId,
  expectedCharacters: string[],
): number {
  if (stageId === "characters") {
    return Math.max(expectedCharacters.length, 1);
  }
  return 1;
}

export function deriveStageStatus(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  expectedCharacters: string[],
): StageStatus {
  const state = readStageState(episodeId, shotId, stageId);
  if (state.phase !== "idle") return state.phase;

  const stored = readStatusFile(episodeId, shotId, stageId);

  const dir = stageDir(episodeId, shotId, stageId);
  const approve = listMediaFiles(path.join(dir, "approve"));
  const output = listMediaFiles(path.join(dir, "output"));
  const needed = expectedApproveCount(stageId, expectedCharacters);

  if (stageId === "characters") {
    const names = expectedCharacters.map((name) => name.toLowerCase());
    const matched = names.length
      ? names.every((name) =>
          approve.some((file) =>
            file.name.toLowerCase().startsWith(`${name}_${shotId}`.toLowerCase()),
          ),
        )
      : approve.length > 0;
    if (matched && approve.length >= needed) return "approved";
  } else if (approve.length >= 1) {
    return "approved";
  }

  if (output.length > 0) return "review";

  const prompt = readTextIfExists(path.join(dir, "prompt.md")).trim();
  const workflow = readTextIfExists(path.join(dir, "workflow.md")).trim();
  if (prompt || workflow || stored.status === "prep") {
    return "prep";
  }

  return "empty";
}

export function charactersApproved(episodeId: string, shotId: string, characters: string[]): boolean {
  const approve = listMediaFiles(path.join(stageDir(episodeId, shotId, "characters"), "approve"));
  if (!characters.length) return approve.length > 0;
  return characters.every((name) =>
    approve.some((file) =>
      file.name.toLowerCase().startsWith(`${name}_${shotId}`.toLowerCase()),
    ),
  );
}

export function locationApproved(episodeId: string, shotId: string): boolean {
  return listMediaFiles(path.join(stageDir(episodeId, shotId, "location"), "approve")).length >= 1;
}
