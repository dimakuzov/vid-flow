import fs from "fs";
import path from "path";
import type { StageId } from "./constants";
import { assertSafeSegment, stageDir } from "./paths";

export interface PromptVersion {
  id: string;
  savedAt: string;
  prompt: string;
}

interface PromptHistoryStore {
  current: string;
  versions: PromptVersion[];
}

const HISTORY_FILE = "prompt_history.json";

function historyPath(shotId: string, stageId: StageId): string {
  return path.join(stageDir(assertSafeSegment(shotId, "shot"), stageId), HISTORY_FILE);
}

function readStore(file: string): PromptHistoryStore {
  if (!fs.existsSync(file)) return { current: "", versions: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PromptHistoryStore>;
    return {
      current: typeof parsed.current === "string" ? parsed.current : "",
      versions: Array.isArray(parsed.versions)
        ? parsed.versions.filter(
            (item): item is PromptVersion =>
              !!item &&
              typeof item.id === "string" &&
              typeof item.savedAt === "string" &&
              typeof item.prompt === "string",
          )
        : [],
    };
  } catch {
    return { current: "", versions: [] };
  }
}

function writeStore(file: string, store: PromptHistoryStore): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2) + "\n", "utf8");
}

function versionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function syncPromptHistory(shotId: string, stageId: StageId): PromptVersion[] {
  const dir = stageDir(assertSafeSegment(shotId, "shot"), stageId);
  const promptFile = path.join(dir, "prompt.md");
  const file = historyPath(shotId, stageId);
  const store = readStore(file);
  let prompt = "";
  try {
    prompt = fs.readFileSync(promptFile, "utf8");
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    if (!missing) return store.versions;
  }
  if (!fs.existsSync(file)) {
    writeStore(file, { current: prompt, versions: [] });
    return [];
  }
  if (store.current && store.current !== prompt) {
    store.versions.unshift({
      id: versionId(),
      savedAt: new Date().toISOString(),
      prompt: store.current,
    });
  }
  store.current = prompt;
  writeStore(file, store);
  return store.versions;
}

export function restorePromptVersion(
  shotId: string,
  stageId: StageId,
  versionIdToRestore: string,
): void {
  syncPromptHistory(shotId, stageId);
  const file = historyPath(shotId, stageId);
  const store = readStore(file);
  const version = store.versions.find((item) => item.id === versionIdToRestore);
  if (!version) throw new Error("Такой версии промпта нет");
  if (store.current && store.current !== version.prompt) {
    store.versions.unshift({
      id: versionId(),
      savedAt: new Date().toISOString(),
      prompt: store.current,
    });
  }
  store.versions = store.versions.filter((item) => item.id !== version.id);
  store.current = version.prompt;
  const dir = stageDir(assertSafeSegment(shotId, "shot"), stageId);
  fs.writeFileSync(path.join(dir, "prompt.md"), version.prompt, "utf8");
  writeStore(file, store);
}
