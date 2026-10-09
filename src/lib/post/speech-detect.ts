import crypto from "crypto";
import fs from "fs";
import path from "path";
import { enqueueComfyJob, readComfyJob } from "../comfy/queue";
import type { ApiPrompt, ComfyJobStatus } from "../contracts/comfy-job";
import { getPlaybooksRoot, listShotIds, toPosix } from "../series/paths";
import { readShotFinal, type ShotFinal } from "./lines";
import { postDir, readJson, writeJson } from "./paths";

/*
 * Где в финале кадра звучит речь: Whisper (ComfyUI-Whisper, граф
 * playbooks/workflows/comfy/create_subtitles_file_from_video.json, JSON не правится) по видео из approve.
 * Прогон — через очередь доски (data/comfy_queue, локальный ComfyUI, бесплатно), текстовые выходы
 * сохраняются файлами (`saveText`). Результат — слова с временем: по ним реплики ставятся под губы.
 *
 *   post/speech/{shotId}.json          какой финал распознавали и каким заданием
 *   post/speech/{shotId}/{jobId}/*.txt выходы нод (слова и фразы Whisper, JSON)
 */

export const SPEECH_GRAPH = "create_subtitles_file_from_video.json";

export interface SpeechWord {
  value: string;
  start: number;
  end: number;
}

interface SpeechRecord {
  shotId: string;
  /** Имя, размер и время файла финала: финал заменили — распознавание устарело. */
  final: string;
  finalSize: number;
  finalMtime: number;
  jobId: string;
  queuedAt: string;
}

export type SpeechStatus = "none" | "queued" | "running" | "done" | "error" | "stale";

export interface ShotSpeech {
  status: SpeechStatus;
  jobId: string | null;
  error: string | null;
  words: SpeechWord[];
  text: string;
}

function speechDir(episodeId: string): string {
  return path.join(postDir(episodeId), "speech");
}

function recordFile(episodeId: string, shotId: string): string {
  return path.join(speechDir(episodeId), `${shotId}.json`);
}

function graphPath(): string {
  return path.join(getPlaybooksRoot(), "workflows", "comfy", SPEECH_GRAPH);
}

function readGraph(): ApiPrompt {
  const graph = readJson<ApiPrompt>(graphPath());
  if (!graph) throw new Error(`Нет графа ${SPEECH_GRAPH} в playbooks/workflows/comfy/`);
  return graph;
}

/** Ноды графа: загрузка видео, Whisper и превью его выходов (слова, фразы, текст). */
export function speechGraphNodes(graph: ApiPrompt) {
  const entries = Object.entries(graph);
  const load = entries.find(([, node]) => node.class_type === "VHS_LoadVideo")?.[0];
  const whisper = entries.find(([, node]) => node.class_type === "Apply Whisper")?.[0];
  if (!load || !whisper) throw new Error(`В ${SPEECH_GRAPH} нет VHS_LoadVideo или Apply Whisper`);
  const previewOf = (output: number) =>
    entries.find(([, node]) => {
      const source = node.inputs?.source;
      return node.class_type === "PreviewAny" && Array.isArray(source) && source[0] === whisper && source[1] === output;
    })?.[0] ?? null;
  return { load, whisper, text: previewOf(0), segments: previewOf(1), words: previewOf(2) };
}

function finalStamp(final: ShotFinal) {
  const stat = fs.statSync(final.file!);
  return { final: path.basename(final.file!), finalSize: stat.size, finalMtime: Math.floor(stat.mtimeMs) };
}

function relativeToCwd(absolute: string): string {
  return toPosix(path.relative(process.cwd(), absolute));
}

/**
 * Ставит распознавание речи для кадров, у финала которых есть свой звук.
 * Без `force` пропускает кадры, где распознавание этого же финала уже есть или идёт.
 */
export async function enqueueSpeechDetect(
  episodeId: string,
  options: { shotIds?: string[]; force?: boolean } = {},
): Promise<{ queued: string[]; skipped: { shotId: string; reason: string }[] }> {
  const graph = readGraph();
  const nodes = speechGraphNodes(graph);
  if (!nodes.words) throw new Error(`В ${SPEECH_GRAPH} нет превью слов Whisper (PreviewAny от выхода words_alignment)`);
  const queued: string[] = [];
  const skipped: { shotId: string; reason: string }[] = [];
  for (const shotId of options.shotIds ?? listShotIds(episodeId)) {
    const final = await readShotFinal(episodeId, shotId);
    if (!final.file || !final.probe) {
      skipped.push({ shotId, reason: "нет финала в approve" });
      continue;
    }
    if (!final.probe.hasAudio) {
      skipped.push({ shotId, reason: "в финале нет звука" });
      continue;
    }
    const current = readSpeechDetect(episodeId, shotId, final);
    if (!options.force && ["queued", "running", "done"].includes(current.status)) {
      skipped.push({ shotId, reason: current.status === "done" ? "уже распознано" : "уже идёт" });
      continue;
    }
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const jobId = `post-speech-${episodeId}-${shotId}-${stamp}-${crypto.randomBytes(2).toString("hex")}`.slice(0, 81);
    const upload = `fb_${episodeId}_${shotId}_${path.basename(final.file)}`;
    const prompt = JSON.parse(JSON.stringify(graph)) as ApiPrompt;
    prompt[nodes.load].inputs.video = upload;
    enqueueComfyJob({
      id: jobId,
      status: "pending",
      episodeId,
      shotId,
      workflow: "speech_detect",
      prompt,
      uploads: [{ path: relativeToCwd(final.file), filename: upload }],
      saveTo: relativeToCwd(path.join(speechDir(episodeId), shotId, jobId)),
      saveText: true,
    });
    const record: SpeechRecord = { shotId, ...finalStamp(final), jobId, queuedAt: new Date().toISOString() };
    writeJson(recordFile(episodeId, shotId), record);
    queued.push(shotId);
  }
  return { queued, skipped };
}

function parseWords(raw: string): SpeechWord[] {
  const data = JSON.parse(raw) as unknown;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => item as { value?: unknown; start?: unknown; end?: unknown })
    .filter((item) => typeof item.value === "string" && typeof item.start === "number" && typeof item.end === "number")
    .map((item) => ({ value: String(item.value), start: Number(item.start), end: Number(item.end) }));
}

/** Распознавание речи кадра. Только чтение: статус берётся из задания очереди, слова — из его файлов. */
export function readSpeechDetect(episodeId: string, shotId: string, final: ShotFinal | null): ShotSpeech {
  const empty: ShotSpeech = { status: "none", jobId: null, error: null, words: [], text: "" };
  const record = readJson<SpeechRecord>(recordFile(episodeId, shotId));
  if (!record) return empty;
  const job = readComfyJob(record.jobId);
  const base = { ...empty, jobId: record.jobId };
  if (!job) return { ...base, status: "error", error: "задание распознавания пропало из очереди" };
  const status: ComfyJobStatus = job.status;
  if (status === "error" || status === "cancelled") return { ...base, status: "error", error: job.error ?? "отменено" };
  if (status === "pending") return { ...base, status: "queued" };
  if (status === "running") return { ...base, status: "running" };
  let stale = false;
  if (final?.file) {
    try {
      const now = finalStamp(final);
      stale = now.final !== record.final || now.finalSize !== record.finalSize || now.finalMtime !== record.finalMtime;
    } catch {
      stale = true;
    }
  }
  let nodes: ReturnType<typeof speechGraphNodes>;
  try {
    nodes = speechGraphNodes(readGraph());
  } catch (error) {
    return { ...base, status: "error", error: error instanceof Error ? error.message : String(error) };
  }
  const saveDir = path.resolve(process.cwd(), job.saveTo);
  const read = (node: string | null) => {
    if (!node) return "";
    const name = (job.files ?? []).find((file) => file === `${node}.txt` || file.startsWith(`${node}-`));
    try {
      return name ? fs.readFileSync(path.join(saveDir, name), "utf8") : "";
    } catch {
      return "";
    }
  };
  let words: SpeechWord[] = [];
  try {
    words = parseWords(read(nodes.words) || "[]");
  } catch {
    return { ...base, status: "error", error: "Whisper вернул слова не в JSON" };
  }
  return { ...base, status: stale ? "stale" : "done", words, text: read(nodes.text).trim() };
}

/** Распознавание по всем кадрам эпизода (для расстановки и интерфейса). */
export function readEpisodeSpeech(episodeId: string, finals: Map<string, ShotFinal>): Map<string, ShotSpeech> {
  const result = new Map<string, ShotSpeech>();
  for (const [shotId, final] of finals) result.set(shotId, readSpeechDetect(episodeId, shotId, final));
  return result;
}
