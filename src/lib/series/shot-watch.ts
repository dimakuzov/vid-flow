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

function watchPath(episodeId: string, shotId: string): string {
  return path.join(shotDir(episodeId, assertSafeSegment(shotId, "shot")), WATCH_FILE);
}

export function readShotWatch(episodeId: string, shotId: string): ShotWatch {
  const file = watchPath(episodeId, shotId);
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
  const approve = listMediaFiles(path.join(stageDir(episodeId, shotId, "final_render"), "approve"));
  return { stopped, stoppedAt, videoDone: approve.length > 0 };
}

export function setShotWatchStopped(
  episodeId: string,
  shotId: string,
  stopped: boolean,
): ShotWatch {
  const file = watchPath(episodeId, shotId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = stopped
    ? { stopped: true, stoppedAt: new Date().toISOString() }
    : { stopped: false, stoppedAt: null };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return readShotWatch(episodeId, shotId);
}
