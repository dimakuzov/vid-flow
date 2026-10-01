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

export function episodeDir(episodeId: string): string {
  return path.join(getEpisodesRoot(), normalizeEpisodeId(episodeId));
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

export function agentInboxRelative(episodeId?: string | null): string {
  const id = episodeId || readCurrentEpisodeId();
  if (!id) return dataRelative("episodes", "<эпизод>", "agent_inbox.md");
  return dataRelative("episodes", id, "agent_inbox.md");
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

export function ensureDataScaffold(): void {
  fs.mkdirSync(getDataRoot(), { recursive: true });
  migrateLegacySeriesLayout();
  fs.mkdirSync(getCharactersRoot(), { recursive: true });
  fs.mkdirSync(getLocationsRoot(), { recursive: true });
  fs.mkdirSync(getReferencesRoot(), { recursive: true });
  fs.mkdirSync(getScenariosRoot(), { recursive: true });
  fs.mkdirSync(getEpisodesRoot(), { recursive: true });
  const show = path.join(getDataRoot(), "show.md");
  if (!fs.existsSync(show)) {
    fs.writeFileSync(
      show,
      "# Сериал\n\nОдин сериал. Общие персонажи, локации, референсы и документы сценариев лежат рядом с папками серий.\n",
      "utf8",
    );
  }
}

export function getSeriesRoot(): string {
  if (process.env.SERIES_ROOT) return path.resolve(process.env.SERIES_ROOT);
  const id = readCurrentEpisodeId();
  if (!id) throw new Error("Эпизод не выбран");
  return episodeDir(id);
}

export function resolveEpisodeRoot(episodeId: string): string {
  if (process.env.SERIES_ROOT) return path.resolve(process.env.SERIES_ROOT);
  return episodeDir(episodeId);
}

export function ensureEpisode(episodeId: string): string {
  const id = normalizeEpisodeId(episodeId);
  ensureDataScaffold();
  const root = resolveEpisodeRoot(id);
  fs.mkdirSync(path.join(root, "shots"), { recursive: true });
  for (const file of ["episode.md", "scenario.md", "scenario_raw.md"]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) fs.writeFileSync(full, "", "utf8");
  }
  writeCurrentEpisodeId(id);
  return id;
}

export function shotsDir(seriesRoot = getSeriesRoot()): string {
  return path.join(seriesRoot, "shots");
}

export function shotDir(shotId: string, seriesRoot = getSeriesRoot()): string {
  return path.join(shotsDir(seriesRoot), shotId);
}

export function stageDir(
  shotId: string,
  stageId: StageId,
  seriesRoot = getSeriesRoot(),
): string {
  return path.join(shotDir(shotId, seriesRoot), stageId);
}

export function ensureSeriesScaffold(seriesRoot = getSeriesRoot()): void {
  fs.mkdirSync(seriesRoot, { recursive: true });
  fs.mkdirSync(shotsDir(seriesRoot), { recursive: true });
  for (const file of ["episode.md", "scenario.md", "scenario_raw.md"]) {
    const full = path.join(seriesRoot, file);
    if (!fs.existsSync(full)) fs.writeFileSync(full, "", "utf8");
  }
}

export function ensureStageDirs(shotId: string, seriesRoot = getSeriesRoot()): void {
  for (const stage of STAGES) {
    const dir = stageDir(shotId, stage, seriesRoot);
    fs.mkdirSync(path.join(dir, "refs"), { recursive: true });
    fs.mkdirSync(path.join(dir, "output"), { recursive: true });
    fs.mkdirSync(path.join(dir, "approve"), { recursive: true });
  }
}

export function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export function assertSafeSegment(value: string, label: string): string {
  if (!value || value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw new Error(`Некорректный ${label}`);
  }
  return value;
}
