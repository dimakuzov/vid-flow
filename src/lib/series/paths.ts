import fs from "fs";
import path from "path";
import { STAGES, type StageId } from "./constants";

const CURRENT_EPISODE_FILE = "current_episode.txt";

export function getDataRoot(): string {
  const configured = process.env.DATA_ROOT;
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), "data");
}

export function getPlaybooksRoot(): string {
  const configured = process.env.PLAYBOOKS_ROOT;
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), "playbooks");
}

export function getCharactersRoot(): string {
  return path.join(getDataRoot(), "characters");
}

export function getLocationsRoot(): string {
  return path.join(getDataRoot(), "locations");
}

export function getReferencesRoot(): string {
  return path.join(getDataRoot(), "references");
}

export function getScenariosRoot(): string {
  return path.join(getDataRoot(), "scenarios");
}

export function getEpisodesRoot(): string {
  return path.join(getDataRoot(), "episodes");
}

export function getComfyQueueRoot(): string {
  return path.join(getDataRoot(), "comfy_queue");
}

export function normalizeEpisodeId(raw: string): string {
  const id = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (!/^[a-z0-9][a-z0-9_-]{0,48}$/.test(id)) {
    throw new Error("Имя эпизода: латиница, цифры, _ и -. Например e01");
  }
  if (
    id === "characters" ||
    id === "locations" ||
    id === "references" ||
    id === "scenarios" ||
    id === "episodes" ||
    id === "series"
  ) {
    throw new Error("Это имя занято служебной папкой");
  }
  return id;
}

export function readCurrentEpisodeId(): string | null {
  if (process.env.SERIES_ROOT) {
    return path.basename(path.resolve(process.env.SERIES_ROOT));
  }
  const file = path.join(getDataRoot(), CURRENT_EPISODE_FILE);
  if (!fs.existsSync(file)) return null;
  const id = fs.readFileSync(file, "utf8").trim();
  if (!id) return null;
  try {
    return normalizeEpisodeId(id);
  } catch {
    return null;
  }
}

export function writeCurrentEpisodeId(episodeId: string): void {
  const id = normalizeEpisodeId(episodeId);
  fs.mkdirSync(getDataRoot(), { recursive: true });
  fs.writeFileSync(path.join(getDataRoot(), CURRENT_EPISODE_FILE), `${id}\n`, "utf8");
}

export function listEpisodeIds(): string[] {
  if (process.env.SERIES_ROOT) {
    try {
      return [normalizeEpisodeId(path.basename(path.resolve(process.env.SERIES_ROOT)))];
    } catch {
      return [];
    }
  }
  const dir = getEpisodesRoot();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      try {
        normalizeEpisodeId(name);
        return true;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function dataRelative(...parts: string[]): string {
  const absolute = path.join(getDataRoot(), ...parts);
  const relative = path.relative(process.cwd(), absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return toPosix(absolute);
  return toPosix(relative);
}

export function agentInboxRelative(episodeId: string): string {
  const absolute = path.join(episodeRoot(episodeId), "agent_inbox.md");
  const relative = path.relative(process.cwd(), absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return toPosix(absolute);
  return toPosix(relative);
}

function moveDirIfDestMissing(source: string, dest: string): void {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) return;
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(source, dest);
}

function migrateLegacySeriesLayout(): void {
  const data = getDataRoot();
  const legacy = path.join(data, "series");
  if (!fs.existsSync(legacy) || !fs.statSync(legacy).isDirectory()) return;

  const episodesRoot = path.join(data, "episodes");
  if (fs.existsSync(episodesRoot)) {
    const existing = fs.readdirSync(episodesRoot).filter((name) => {
      try {
        return fs.statSync(path.join(episodesRoot, name)).isDirectory();
      } catch {
        return false;
      }
    });
    if (existing.length > 0) return;
  }

  moveDirIfDestMissing(path.join(legacy, "characters"), path.join(data, "characters"));
  moveDirIfDestMissing(path.join(legacy, "locations"), path.join(data, "locations"));
  fs.mkdirSync(episodesRoot, { recursive: true });
  const target = path.join(episodesRoot, "e01");
  if (!fs.existsSync(target)) fs.renameSync(legacy, target);

  const currentFile = path.join(data, CURRENT_EPISODE_FILE);
  if (!fs.existsSync(currentFile)) fs.writeFileSync(currentFile, "e01\n", "utf8");

  const scenarioPath = path.join(target, "scenario.md");
  const rawPath = path.join(target, "scenario_raw.md");
  if (fs.existsSync(scenarioPath) && !fs.existsSync(rawPath)) {
    const text = fs.readFileSync(scenarioPath, "utf8");
    if (text.trim() && !/^##\s*s?\d+/im.test(text)) {
      fs.writeFileSync(rawPath, text.endsWith("\n") ? text : `${text}\n`, "utf8");
      fs.writeFileSync(scenarioPath, "", "utf8");
    }
  }
}

/**
 * Готовит папку данных: переносит старую раскладку `data/series/` и создаёт общие папки.
 * Вызывается один раз при старте процесса (instrumentation, скрипты), а не при каждом чтении.
 */
export function prepareDataRoot(): void {
  fs.mkdirSync(getDataRoot(), { recursive: true });
  migrateLegacySeriesLayout();
  fs.mkdirSync(getCharactersRoot(), { recursive: true });
  fs.mkdirSync(getLocationsRoot(), { recursive: true });
  fs.mkdirSync(getReferencesRoot(), { recursive: true });
  fs.mkdirSync(getScenariosRoot(), { recursive: true });
  fs.mkdirSync(getEpisodesRoot(), { recursive: true });
  fs.mkdirSync(getComfyQueueRoot(), { recursive: true });
  const show = path.join(getDataRoot(), "show.md");
  if (!fs.existsSync(show)) {
    fs.writeFileSync(
      show,
      "# Series\n\nOne series. Shared characters, locations, references and script documents live next to the episode folders.\n",
      "utf8",
    );
  }
}

/** Папка эпизода. `SERIES_ROOT` подменяет её для единственного эпизода. */
export function episodeRoot(episodeId: string): string {
  const id = normalizeEpisodeId(episodeId);
  if (process.env.SERIES_ROOT) return path.resolve(process.env.SERIES_ROOT);
  return path.join(getEpisodesRoot(), id);
}

/** Эпизод по умолчанию для UI (`current_episode.txt`). Ошибка, если не выбран. */
export function requireCurrentEpisodeId(): string {
  const id = readCurrentEpisodeId();
  if (!id) throw new Error("Эпизод не выбран");
  return id;
}

/** Создаёт папку эпизода. Открытый эпизод (`current_episode.txt`) не меняет. */
export function createEpisode(episodeId: string): string {
  const id = normalizeEpisodeId(episodeId);
  prepareDataRoot();
  ensureEpisodeScaffold(id);
  return id;
}

export function ensureEpisodeScaffold(episodeId: string): void {
  const root = episodeRoot(episodeId);
  fs.mkdirSync(path.join(root, "shots"), { recursive: true });
  for (const file of ["episode.md", "scenario.md", "scenario_raw.md"]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) fs.writeFileSync(full, "", "utf8");
  }
}

export function shotsDir(episodeId: string): string {
  return path.join(episodeRoot(episodeId), "shots");
}

export function shotDir(episodeId: string, shotId: string): string {
  return path.join(shotsDir(episodeId), assertSafeSegment(shotId, "кадр"));
}

export function stageDir(episodeId: string, shotId: string, stageId: StageId): string {
  if (!STAGES.includes(stageId)) throw new Error("Неизвестный этап");
  return path.join(shotDir(episodeId, shotId), stageId);
}

export function ensureStageDirs(episodeId: string, shotId: string): void {
  for (const stage of STAGES) {
    const dir = stageDir(episodeId, shotId, stage);
    fs.mkdirSync(path.join(dir, "refs"), { recursive: true });
    fs.mkdirSync(path.join(dir, "output"), { recursive: true });
    fs.mkdirSync(path.join(dir, "approve"), { recursive: true });
  }
}

/** Папка кадра: `s01` или `s` и название без пробелов и слешей. */
export function isShotId(value: string): boolean {
  return /^s[^\\/\s.]+$/i.test(value) && !value.includes("..");
}

/** Порядок кадров из `shot_order.json`. Пусто — на диске ещё нет своего порядка. */
export function readShotOrder(episodeId: string): string[] {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(episodeRoot(episodeId), "shot_order.json"), "utf8")) as {
      ids?: unknown;
    };
    if (!Array.isArray(data.ids)) return [];
    return data.ids.filter((id): id is string => typeof id === "string" && isShotId(id));
  } catch {
    return [];
  }
}

function isShotDir(parent: string, name: string): boolean {
  if (!isShotId(name)) return false;
  if (/^s\d+$/i.test(name)) return true;
  return fs.existsSync(path.join(parent, name, "shot.md"));
}

export function listShotIds(episodeId: string): string[] {
  const dir = shotsDir(episodeId);
  if (!fs.existsSync(dir)) return [];
  const onDisk = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isShotDir(dir, entry.name))
    .map((entry) => entry.name);
  const byLower = new Map(onDisk.map((name) => [name.toLowerCase(), name]));
  const listed: string[] = [];
  for (const id of readShotOrder(episodeId)) {
    const found = byLower.get(id.toLowerCase());
    if (found && !listed.includes(found)) listed.push(found);
  }
  const rest = onDisk
    .filter((name) => !listed.some((id) => id.toLowerCase() === name.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return [...listed, ...rest];
}

export function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

/** true, если target лежит внутри root (с разделителем: `e010` не внутри `e01`). */
export function isInside(root: string, target: string): boolean {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  return resolved === base || resolved.startsWith(base + path.sep);
}

export function assertSafeSegment(value: string, label: string): string {
  if (!value || value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw new Error(`Некорректный ${label}`);
  }
  return value;
}
