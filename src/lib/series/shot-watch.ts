import fs from "fs";
import path from "path";
import { listMediaFiles } from "./media";
import { assertSafeSegment, shotDir, stageDir } from "./paths";

const WATCH_FILE = "agent_watch.json";

export interface ShotWatch {
  stopped: boolean;
  stoppedAt: string | null;
  videoDone: boolean;
}

function watchPath(shotId: string): string {
  return path.join(shotDir(assertSafeSegment(shotId, "shot")), WATCH_FILE);
}

export function readShotWatch(shotId: string): ShotWatch {
  const file = watchPath(shotId);
  let stopped = false;
  let stoppedAt: string | null = null;
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
        stopped?: boolean;
        stoppedAt?: string;
      };
      stopped = data.stopped === true;
      stoppedAt = typeof data.stoppedAt === "string" ? data.stoppedAt : null;
    } catch {
      stopped = false;
    }
  }
  const approve = listMediaFiles(path.join(stageDir(shotId, "final_render"), "approve"));
  return { stopped, stoppedAt, videoDone: approve.length > 0 };
}

export function setShotWatchStopped(shotId: string, stopped: boolean): ShotWatch {
  const file = watchPath(shotId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = stopped
    ? { stopped: true, stoppedAt: new Date().toISOString() }
    : { stopped: false, stoppedAt: null };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return readShotWatch(shotId);
}
