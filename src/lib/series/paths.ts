import fs from "fs";
import path from "path";
import { STAGES, type StageId } from "./constants";

export function getSeriesRoot(): string {
  const configured = process.env.SERIES_ROOT;
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(process.cwd(), "data", "series");
}

export function getPlaybooksRoot(): string {
  const configured = process.env.PLAYBOOKS_ROOT;
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(process.cwd(), "playbooks");
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
  for (const file of ["series.md", "scenario.md"]) {
    const full = path.join(seriesRoot, file);
    if (!fs.existsSync(full)) {
      fs.writeFileSync(full, "", "utf8");
    }
  }
}

export function ensureStageDirs(
  shotId: string,
  seriesRoot = getSeriesRoot(),
): void {
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
