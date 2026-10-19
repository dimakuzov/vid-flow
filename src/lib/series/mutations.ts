import fs from "fs";
import path from "path";
import type { StageId } from "./constants";
import { listMediaFiles } from "./media";
import { assertSafeSegment, ensureStageDirs, getDataRoot, isInside, isShotId, shotDir, shotsDir, stageDir } from "./paths";
import { syncPromptHistory } from "./prompt-history";
import { readShotMeta } from "./shot-meta";
import { readStatusFile, writeStatusFile } from "./status";
import { readStageState, setIdle } from "./stage-state";

/** Ручное действие пользователя снимает показ прошлой ошибки. Идущую операцию не трогает. */
function clearStageError(episodeId: string, shotId: string, stageId: StageId): void {
  if (readStageState(episodeId, shotId, stageId).phase === "error") setIdle(episodeId, shotId, stageId);
}

/** Номер части имени файла, с которой начинается имя персонажа. -1 — имени нет. */
function namePosition(stem: string, token: string): number {
  if (stem === token || stem.startsWith(`${token}_`) || stem.startsWith(`${token}-`)) return 0;
  const segments = stem.split(/[_-]+/).filter(Boolean);
  const parts = token.split(/[_-]+/).filter(Boolean);
  if (!parts.length) return -1;
  return segments.findIndex((_, index) =>
    parts.every((part, offset) => segments[index + offset] === part),
  );
}

/**
 * Персонаж кадра по имени файла. В имени может быть несколько персонажей: `Lena_mom_body.png` —
 * это мама Лены. Тогда сначала тот, кого ещё нет в approve (`taken`), затем тот, чьё имя
 * стоит в имени файла позже (`lena_mom` — мама), затем более длинное имя.
 */
function matchCharacter(filename: string, characters: string[], taken: Set<string> = new Set()): string | null {
  const stem = path.parse(path.basename(filename)).name.toLowerCase();
  const found = characters
    .map((name) => ({ name, at: namePosition(stem, name.toLowerCase()) }))
    .filter((item) => item.at >= 0);
  if (!found.length) return null;
  const free = found.filter((item) => !taken.has(item.name.toLowerCase()));
  const pool = free.length ? free : found;
  pool.sort((a, b) => b.at - a.at || b.name.length - a.name.length);
  return pool[0].name;
}

function characterApproveName(
  filename: string,
  shotId: string,
  characters: string[],
  taken?: Set<string>,
): string | null {
  const parsed = path.parse(path.basename(filename));
  const matched = matchCharacter(filename, characters, taken);
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

/** Пользователь сам менял refs/: агент их не пересобирает (agent_touch.json). */
function markRefsTouched(episodeId: string, shotId: string, stageId: StageId): void {
  fs.writeFileSync(
    path.join(stageDir(episodeId, shotId, stageId), "agent_touch.json"),
    JSON.stringify({ refsTouchedByUser: true, touchedAt: new Date().toISOString() }, null, 2) + "\n",
  );
}

export async function saveUpload(options: {
  episodeId: string;
  shotId: string;
  stageId: StageId;
  target: "refs" | "output";
  filename: string;
  bytes: Buffer;
  approveAfter?: boolean;
}): Promise<{ savedAs: string; approvedAs?: string }> {
  const episodeId = options.episodeId;
  const shotId = assertSafeSegment(options.shotId, "shot");
  ensureStageDirs(episodeId, shotId);
  const dir = path.join(stageDir(episodeId, shotId, options.stageId), options.target);
  fs.mkdirSync(dir, { recursive: true });
  const savedAs = uniqueTarget(dir, path.basename(options.filename));
  fs.writeFileSync(path.join(dir, savedAs), options.bytes);

  if (options.target === "refs") markRefsTouched(episodeId, shotId, options.stageId);

  if (options.approveAfter) {
    const approvedAs = approveFiles({
      episodeId,
      shotId,
      stageId: options.stageId,
      filenames: [savedAs],
      from: options.target === "refs" ? "refs" : "output",
    })[0];
    return { savedAs, approvedAs };
  }

  if (options.target === "output") {
    writeStatusFile(episodeId, shotId, options.stageId, { status: "review" });
    clearStageError(episodeId, shotId, options.stageId);
  }

  return { savedAs };
}

export function approveFiles(options: {
  episodeId: string;
  shotId: string;
  stageId: StageId;
  filenames: string[];
  from?: "output" | "refs";
}): string[] {
  const episodeId = options.episodeId;
  const shotId = assertSafeSegment(options.shotId, "shot");
  ensureStageDirs(episodeId, shotId);
  const stagePath = stageDir(episodeId, shotId, options.stageId);
  const fromDir = path.join(stagePath, options.from || "output");
  const approveDir = path.join(stagePath, "approve");
  fs.mkdirSync(approveDir, { recursive: true });

  if (options.stageId !== "characters") {
    for (const existing of fs.readdirSync(approveDir)) {
      fs.unlinkSync(path.join(approveDir, existing));
    }
  }

  const characters =
    options.stageId === "characters" ? readShotMeta(episodeId, shotId).characters : [];
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
    // Кто уже в approve: файл с двумя именами достаётся тому, кого там ещё нет.
    const taken =
      options.stageId === "characters"
        ? new Set(fs.readdirSync(approveDir).map((existing) => approvedSlot(existing, shotId)))
        : undefined;
    const targetName =
      options.stageId === "characters"
        ? characterApproveName(safeName, shotId, characters, taken)
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

  writeStatusFile(episodeId, shotId, options.stageId, { status: "approved" });
  clearStageError(episodeId, shotId, options.stageId);
  return [...new Set(saved)];
}

export function removeApprovedFile(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  filename: string,
): string {
  const safeShot = assertSafeSegment(shotId, "shot");
  const safeName = path.basename(filename);
  if (!safeName || safeName !== filename || safeName === "." || safeName === "..") {
    throw new Error("Некорректное имя файла");
  }
  const approveDir = path.join(stageDir(episodeId, safeShot, stageId), "approve");
  const target = path.join(approveDir, safeName);
  if (!target.startsWith(approveDir + path.sep)) {
    throw new Error("Некорректное имя файла");
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`Файл не найден: ${safeName}`);
  }
  fs.unlinkSync(target);

  const remaining = listMediaFiles(approveDir);
  const output = listMediaFiles(path.join(stageDir(episodeId, safeShot, stageId), "output"));
  const names = stageId === "characters" ? readShotMeta(episodeId, safeShot).characters : [];
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
  if (!stillApproved && readStatusFile(episodeId, safeShot, stageId).status === "approved") {
    writeStatusFile(episodeId, safeShot, stageId, { status: output.length ? "review" : "prep" });
  }
  return safeName;
}

/**
 * Удалить файл из output/ или refs/ этапа насовсем (без корзины). Кнопка на доске —
 * это и есть подтверждение пользователя. approve/ — через removeApprovedFile.
 */
export function deleteStageFile(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  folder: "output" | "refs",
  filename: string,
): string {
  const safeShot = assertSafeSegment(shotId, "shot");
  if (folder !== "output" && folder !== "refs") throw new Error("Удалять можно только из output/ и refs/");
  const safeName = path.basename(filename);
  if (!safeName || safeName !== filename || safeName === "." || safeName === "..") {
    throw new Error("Некорректное имя файла");
  }
  if (folder === "refs" && readStageState(episodeId, safeShot, stageId).busy) {
    throw new Error(
      "Этап занят: граф или агент сейчас читает refs/. Удалить референс можно после прогона или «Отменить».",
    );
  }
  const dir = path.join(stageDir(episodeId, safeShot, stageId), folder);
  const target = path.join(dir, safeName);
  if (!target.startsWith(dir + path.sep)) throw new Error("Некорректное имя файла");
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`Файл не найден в ${folder}/: ${safeName}`);
  }
  fs.unlinkSync(target);

  if (folder === "refs") {
    markRefsTouched(episodeId, safeShot, stageId);
  } else if (
    !listMediaFiles(dir).length &&
    readStatusFile(episodeId, safeShot, stageId).status === "review"
  ) {
    writeStatusFile(episodeId, safeShot, stageId, { status: "prep" });
  }
  return safeName;
}

export function updateStageDocs(options: {
  episodeId: string;
  shotId: string;
  stageId: StageId;
  prompt?: string;
  llmNotes?: string;
  refs?: string;
  workflow?: string;
}): void {
  const episodeId = options.episodeId;
  const shotId = assertSafeSegment(options.shotId, "shot");
  const dir = stageDir(episodeId, shotId, options.stageId);
  fs.mkdirSync(dir, { recursive: true });
  if (typeof options.prompt === "string") {
    syncPromptHistory(episodeId, shotId, options.stageId);
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
    syncPromptHistory(episodeId, shotId, options.stageId);
  }
}

export function listApprove(episodeId: string, shotId: string, stageId: StageId) {
  return listMediaFiles(path.join(stageDir(episodeId, shotId, stageId), "approve"));
}

/** Связь нового файла в output/ с исходником. Файл `output/edits.json`. */
export interface ImageEditRecord {
  file: string;
  from: string;
  kind: "crop" | "edit";
  prompt?: string;
  workflow?: string;
  at: string;
}

function editsFile(episodeId: string, shotId: string, stageId: StageId): string {
  return path.join(stageDir(episodeId, shotId, stageId), "output", "edits.json");
}

function isImageEditRecord(value: unknown): value is ImageEditRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as ImageEditRecord;
  return (
    typeof item.file === "string" &&
    typeof item.from === "string" &&
    (item.kind === "crop" || item.kind === "edit") &&
    typeof item.at === "string"
  );
}

/** Связи «новый файл ← исходник». Пустого файла нет — пустой список. */
export function readImageEdits(episodeId: string, shotId: string, stageId: StageId): ImageEditRecord[] {
  const file = editsFile(episodeId, shotId, stageId);
  if (!fs.existsSync(file)) return [];
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("output/edits.json не читается");
  }
  if (!Array.isArray(data)) throw new Error("output/edits.json повреждён");
  return data.filter(isImageEditRecord);
}

/** Записать список целиком. Нужно, когда очередь сохранила файл под другим именем. */
export function writeImageEdits(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  records: ImageEditRecord[],
): void {
  const dir = path.join(stageDir(episodeId, shotId, stageId), "output");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "edits.json"), JSON.stringify(records, null, 2) + "\n");
}

/** Дописать одну связь. Исходный файл не открывается на запись. */
export function recordImageEdit(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  record: ImageEditRecord,
): void {
  const records = readImageEdits(episodeId, shotId, stageId);
  records.push(record);
  writeImageEdits(episodeId, shotId, stageId, records);
}

/**
 * Имя нового файла в output/, которого ещё нет на диске.
 * Совпадение — суффикс, как у загрузки (`photo.png` → `photo_1.png`).
 */
export function reserveOutputName(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  filename: string,
): string {
  const shot = assertSafeSegment(shotId, "shot");
  ensureStageDirs(episodeId, shot);
  const dir = path.join(stageDir(episodeId, shot, stageId), "output");
  fs.mkdirSync(dir, { recursive: true });
  return uniqueTarget(dir, path.basename(filename));
}

function assertImageName(filename: string): string {
  const safeName = path.basename(filename);
  if (!safeName || safeName !== filename || safeName === "." || safeName === "..") {
    throw new Error("Некорректное имя файла");
  }
  return safeName;
}

/**
 * Обрезка из браузера: байты уже обрезаны, доска только кладёт новый PNG в output/.
 * Исходник в output/ или approve/ не меняется.
 */
export function saveCroppedImage(options: {
  episodeId: string;
  shotId: string;
  stageId: StageId;
  folder: "output" | "approve";
  filename: string;
  bytes: Buffer;
}): { savedAs: string } {
  const shotId = assertSafeSegment(options.shotId, "shot");
  const safeName = assertImageName(options.filename);
  if (options.folder !== "output" && options.folder !== "approve") {
    throw new Error("Обрезать можно файл из output/ или approve/");
  }
  if (!options.bytes.length) throw new Error("Пустая обрезка");
  ensureStageDirs(options.episodeId, shotId);
  const stagePath = stageDir(options.episodeId, shotId, options.stageId);
  const source = path.join(stagePath, options.folder, safeName);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`Файл не найден: ${safeName}`);
  }
  const parsed = path.parse(safeName);
  const dir = path.join(stagePath, "output");
  fs.mkdirSync(dir, { recursive: true });
  const savedAs = uniqueTarget(dir, `${parsed.name}_crop.png`);
  const target = path.join(dir, savedAs);
  fs.writeFileSync(target, options.bytes);
  recordImageEdit(options.episodeId, shotId, options.stageId, {
    file: savedAs,
    from: safeName,
    kind: "crop",
    at: new Date().toISOString(),
  });
  writeStatusFile(options.episodeId, shotId, options.stageId, { status: "review" });
  clearStageError(options.episodeId, shotId, options.stageId);
  return { savedAs };
}

/**
 * Копии выбранных файлов в refs/ этапа. Имя сохраняется, при совпадении — суффикс.
 * Исходники не трогаются. Папка помечается правкой пользователя.
 */
/**
 * Копия чужих утверждённых картинок в approve/ персонажей этого кадра.
 * Имя становится `{персонаж}_{shotId}`. Исходные файлы не меняются.
 */
export function copyIntoCharacterApprove(options: {
  episodeId: string;
  shotId: string;
  files: { absolute: string; filename: string }[];
  /** Брать только файл, в имени которого есть персонаж этого кадра. */
  requireNameMatch?: boolean;
}): string[] {
  const shotId = assertSafeSegment(options.shotId, "shot");
  const stageId: StageId = "characters";
  if (readStageState(options.episodeId, shotId, stageId).busy) {
    throw new Error("Этап занят. Добавить можно после прогона или «Отменить».");
  }
  if (!options.files.length) throw new Error("Не выбраны файлы");
  ensureStageDirs(options.episodeId, shotId);
  const approveDir = path.join(stageDir(options.episodeId, shotId, stageId), "approve");
  fs.mkdirSync(approveDir, { recursive: true });
  const characters = readShotMeta(options.episodeId, shotId).characters;
  const dataRoot = getDataRoot();
  const taken = new Set(fs.readdirSync(approveDir).map((existing) => approvedSlot(existing, shotId)));
  const saved: string[] = [];
  for (const file of options.files) {
    if (!isInside(dataRoot, file.absolute)) throw new Error("Файл вне data/");
    if (!fs.existsSync(file.absolute) || !fs.statSync(file.absolute).isFile()) {
      throw new Error(`Файл не найден: ${file.filename}`);
    }
    if (options.requireNameMatch && !matchCharacter(file.filename, characters, taken)) continue;
    const targetName = characterApproveName(file.filename, shotId, characters, taken);
    if (!targetName) continue;
    const slot = approvedSlot(targetName, shotId);
    for (const existing of fs.readdirSync(approveDir)) {
      if (approvedSlot(existing, shotId) === slot && existing !== targetName) {
        fs.unlinkSync(path.join(approveDir, existing));
      }
    }
    fs.copyFileSync(file.absolute, path.join(approveDir, targetName));
    taken.add(slot);
    saved.push(targetName);
  }
  if (!saved.length) {
    const expected = characters.length ? characters.join(", ") : shotId;
    throw new Error(`Нет картинки персонажа этого кадра (${expected}).`);
  }
  writeStatusFile(options.episodeId, shotId, stageId, { status: "approved" });
  clearStageError(options.episodeId, shotId, stageId);
  return [...new Set(saved)];
}

export function copyFilesToRefs(options: {
  episodeId: string;
  shotId: string;
  stageId: StageId;
  files: { absolute: string; filename: string }[];
}): string[] {
  if (!options.files.length) throw new Error("Не выбраны файлы");
  const shotId = assertSafeSegment(options.shotId, "shot");
  ensureStageDirs(options.episodeId, shotId);
  const dir = path.join(stageDir(options.episodeId, shotId, options.stageId), "refs");
  fs.mkdirSync(dir, { recursive: true });
  const dataRoot = getDataRoot();
  const saved: string[] = [];
  for (const file of options.files) {
    if (!isInside(dataRoot, file.absolute)) throw new Error("Файл вне data/");
    if (!fs.existsSync(file.absolute) || !fs.statSync(file.absolute).isFile()) {
      throw new Error(`Файл не найден: ${file.filename}`);
    }
    const targetName = uniqueTarget(dir, path.basename(file.filename));
    fs.copyFileSync(file.absolute, path.join(dir, targetName));
    saved.push(targetName);
  }
  markRefsTouched(options.episodeId, shotId, options.stageId);
  return saved;
}

export function deleteShot(episodeId: string, shotId: string): void {
  const id = assertSafeSegment(shotId, "кадр");
  if (!isShotId(id)) throw new Error("Некорректный кадр");
  const dir = path.resolve(shotDir(episodeId, id));
  const root = path.resolve(shotsDir(episodeId));
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw new Error("Некорректный кадр");
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
