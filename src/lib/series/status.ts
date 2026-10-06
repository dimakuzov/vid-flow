import fs from "fs";
import path from "path";
import type { StageId, StageStatus } from "./constants";
import { listMediaFiles, readTextIfExists } from "./media";
import { stageDir } from "./paths";

export interface StatusFile {
  status?: StageStatus;
  expectedCharacters?: string[];
  updatedAt?: string;
  notes?: string;
}

export function readStatusFile(shotId: string, stageId: StageId): StatusFile {
  const file = path.join(stageDir(shotId, stageId), "status.json");
  const raw = readTextIfExists(file);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as StatusFile;
  } catch {
    return {};
  }
}

export function writeStatusFile(
  shotId: string,
  stageId: StageId,
  data: StatusFile,
): void {
  const file = path.join(stageDir(shotId, stageId), "status.json");
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
  shotId: string,
  stageId: StageId,
  expectedCharacters: string[],
): StageStatus {
  const stored = readStatusFile(shotId, stageId);
  if (stored.status === "waiting") return "waiting";

  const dir = stageDir(shotId, stageId);
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

export function charactersApproved(shotId: string, characters: string[]): boolean {
  const approve = listMediaFiles(path.join(stageDir(shotId, "characters"), "approve"));
  if (!characters.length) return approve.length > 0;
  return characters.every((name) =>
    approve.some((file) =>
      file.name.toLowerCase().startsWith(`${name}_${shotId}`.toLowerCase()),
    ),
  );
}

export function locationApproved(shotId: string): boolean {
  return listMediaFiles(path.join(stageDir(shotId, "location"), "approve")).length >= 1;
}
