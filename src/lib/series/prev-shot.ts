import fs from "fs";
import path from "path";
import { mediaUrlPath, resolveMediaPath } from "./media";
import { copyFilesToRefs, copyIntoCharacterApprove } from "./mutations";
import { listShotIds, shotsDir, stageDir } from "./paths";
import type { StageId } from "./constants";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** Утверждённая картинка предыдущего кадра, которую можно скопировать. */
export interface EarlierApprove {
  shotId: string;
  name: string;
  path: string;
  label: string;
}

function approveImages(episodeId: string, shotId: string, stageId: StageId): string[] {
  const dir = path.join(stageDir(episodeId, shotId, stageId), "approve");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => IMAGE_EXT.has(path.extname(name).toLowerCase()))
    .filter((name) => {
      try {
        return fs.statSync(path.join(dir, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Предыдущий кадр в порядке s01, s02, … null у первого. */
export function previousShotId(episodeId: string, shotId: string): string | null {
  const ids = listShotIds(episodeId);
  const index = ids.indexOf(shotId);
  if (index <= 0) return null;
  return ids[index - 1];
}

function earlierShotIds(episodeId: string, shotId: string): string[] {
  const ids = listShotIds(episodeId);
  const index = ids.indexOf(shotId);
  if (index <= 0) return [];
  return ids.slice(0, index);
}

/**
 * Картинки из approve/ предыдущего кадра того же этапа → refs/ этого.
 * Только локация и персонажи. Исходник остаётся в том кадре.
 */
export function copyPreviousApproveToRefs(options: {
  episodeId: string;
  shotId: string;
  stageId: StageId;
}): string[] {
  if (options.stageId !== "location" && options.stageId !== "characters") {
    throw new Error("Из предыдущего кадра можно добавить только на локации и персонажах");
  }
  const prev = previousShotId(options.episodeId, options.shotId);
  if (!prev) throw new Error("Это первый кадр");
  const names = approveImages(options.episodeId, prev, options.stageId);
  if (!names.length) throw new Error("В предыдущем кадре ничего не утверждено");
  return copyFilesToRefs({
    episodeId: options.episodeId,
    shotId: options.shotId,
    stageId: options.stageId,
    files: names.map((name) => ({
      absolute: path.join(stageDir(options.episodeId, prev, options.stageId), "approve", name),
      filename: name,
    })),
  });
}

/** Утверждённые картинки персонажей из кадров до этого. */
export function listEarlierCharacterApproves(episodeId: string, shotId: string): EarlierApprove[] {
  const files: EarlierApprove[] = [];
  for (const id of earlierShotIds(episodeId, shotId)) {
    for (const name of approveImages(episodeId, id, "characters")) {
      const relative = mediaUrlPath(path.join(stageDir(episodeId, id, "characters"), "approve", name));
      if (!relative) continue;
      files.push({ shotId: id, name, path: relative, label: `${id} · ${name}` });
    }
  }
  return files;
}

/** approve/ персонажей предыдущего кадра → approve/ этого. Тот же рисунок, имя этого кадра. */
export function copyPreviousCharacterApprove(episodeId: string, shotId: string): string[] {
  const prev = previousShotId(episodeId, shotId);
  if (!prev) throw new Error("Это первый кадр");
  const names = approveImages(episodeId, prev, "characters");
  if (!names.length) throw new Error("В предыдущем кадре ничего не утверждено");
  return copyIntoCharacterApprove({
    episodeId,
    shotId,
    requireNameMatch: true,
    files: names.map((name) => ({
      absolute: path.join(stageDir(episodeId, prev, "characters"), "approve", name),
      filename: name,
    })),
  });
}

/** Выбранные approve предыдущих кадров → approve/ персонажей этого. */
export function copyPickedCharacterApproves(episodeId: string, shotId: string, paths: string[]): string[] {
  if (!paths.length) throw new Error("Не выбраны файлы");
  const allowed = new Set(earlierShotIds(episodeId, shotId));
  const root = shotsDir(episodeId);
  const files = paths.map((item) => {
    const absolute = resolveMediaPath(item.split("/").filter(Boolean));
    const relative = path.relative(root, absolute);
    const parts = relative.split(path.sep);
    if (
      parts.length !== 4 ||
      parts[1] !== "characters" ||
      parts[2] !== "approve" ||
      !allowed.has(parts[0]) ||
      !IMAGE_EXT.has(path.extname(parts[3]).toLowerCase())
    ) {
      throw new Error("Можно взять только утверждённую картинку персонажа из предыдущего кадра");
    }
    return { absolute, filename: parts[3] };
  });
  return copyIntoCharacterApprove({ episodeId, shotId, requireNameMatch: true, files });
}
