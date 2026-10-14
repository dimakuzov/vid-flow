import crypto from "crypto";
import fs from "fs";
import path from "path";
import { elevenKey } from "./elevenlabs";
import { readPostLines, writePostLines, type PostLine } from "./lines";
import { jobsDir, readJson, writeJson } from "./paths";
import { isolationCredits } from "./elevenlabs";
import {
  generateCharacterVoice,
  isolateCurrentVoice,
  planCharacterVoice,
  readCurrentVoice,
  readVoiceConfig,
} from "./voices";

/*
 * Задание озвучки `post/jobs/voice-*.json`. Ставит только кнопка «Озвучить» с галочкой
 * «Разрешить платную отправку в ElevenLabs» (одно задание — одно разрешение).
 * Выполняется в процессе доски сразу после постановки. Повторной отправки нет: упавшее
 * или прерванное задание — `error`, перезапуск решает пользователь.
 */

export type VoiceJobStatus = "pending" | "running" | "done" | "error";

export interface VoiceJob {
  id: string;
  episodeId: string;
  characters: string[];
  /** `voice` — новая озвучка (и очистка, если включена); `isolate` — только очистка текущей озвучки. */
  kind?: "voice" | "isolate";
  status: VoiceJobStatus;
  /** Символов к отправке (оценка стоимости, показана при постановке). */
  chars: number;
  /** Примерно кредитов на Voice Isolator. */
  isolationChars?: number;
  allowPaid: true;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  pid?: number;
  progress?: string;
  results: { character: string; version: number; isolation?: "done" | "error" | "off"; isolationError?: string }[];
  error?: string;
}

const ACTIVE = "__frameboardVoiceJobs";

function active(): Set<string> {
  const g = globalThis as typeof globalThis & { [ACTIVE]?: Set<string> };
  if (!g[ACTIVE]) g[ACTIVE] = new Set();
  return g[ACTIVE]!;
}

function jobFile(episodeId: string, id: string): string {
  return path.join(jobsDir(episodeId), `${id}.json`);
}

export function listVoiceJobs(episodeId: string): VoiceJob[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(jobsDir(episodeId)).filter((name) => /^voice-.+\.json$/.test(name));
  } catch {
    return [];
  }
  return names
    .map((name) => readJson<VoiceJob>(path.join(jobsDir(episodeId), name)))
    .filter((job): job is VoiceJob => Boolean(job))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Задание `running`/`pending`, которое этот процесс не выполняет: доска перезапускалась посреди. */
function isInterrupted(job: VoiceJob): boolean {
  return (job.status === "running" || job.status === "pending") && !active().has(job.id);
}

/** Последнее задание эпизода; прерванное показывается как ошибка (без записи). */
export function readLatestVoiceJob(episodeId: string): VoiceJob | null {
  const job = listVoiceJobs(episodeId).pop() ?? null;
  if (job && isInterrupted(job)) return { ...job, status: "error", error: interruptedText(job) };
  return job;
}

function interruptedText(job: VoiceJob): string {
  return `Озвучка прервалась (доска перезапускалась)${job.progress ? ` на шаге «${job.progress}»` : ""}. Символы за отправленные запросы уже списаны — проверьте историю в ElevenLabs и запустите снова, если нужно.`;
}

export interface VoicePlan {
  character: string;
  lines: PostLine[];
  chars: number;
  isolationChars: number;
}

/** Что уйдёт в ElevenLabs по персонажам (для кнопки и оценки стоимости). Без записи. */
export async function planVoices(episodeId: string, characters: string[]): Promise<VoicePlan[]> {
  const { lines } = await readPostLines(episodeId);
  return characters.map((character) => {
    const own = lines.filter((line) => line.character.toLowerCase() === character.toLowerCase());
    if (!own.length) throw new Error(`У ${character} нет реплик в speech.md`);
    const config = readVoiceConfig(character);
    if (!config) throw new Error(`У ${character} нет voice.json с voice_id — заполните голос`);
    const plan = planCharacterVoice(own, config);
    return { character: own[0].character, lines: own, chars: plan.chars, isolationChars: plan.isolationChars };
  });
}

/** Очистка текущей озвучки: сколько кредитов уйдёт (по длине готового файла). Без записи. */
export function planIsolation(episodeId: string, characters: string[]): { character: string; isolationChars: number }[] {
  return characters.map((character) => {
    const current = readCurrentVoice(episodeId, character);
    if (!current) throw new Error(`У ${character} нет озвучки — сначала озвучьте`);
    if (current.isolation?.status === "done") throw new Error(`У ${character} озвучка v${current.version} уже очищена`);
    return { character: current.character, isolationChars: isolationCredits(current.duration) };
  });
}

/** «Озвучить». Без `allowPaid` ничего не ставится и в ElevenLabs ничего не уходит. */
export async function enqueueVoiceJob(
  episodeId: string,
  options: { characters: string[]; allowPaid?: boolean; kind?: "voice" | "isolate" },
): Promise<VoiceJob> {
  if (options.allowPaid !== true) {
    throw new Error("Поставьте галочку «Разрешить платную отправку в ElevenLabs»: озвучка списывает символы тарифа");
  }
  const characters = [...new Set(options.characters.map((name) => name.trim()).filter(Boolean))];
  if (!characters.length) throw new Error("Выберите персонажей для озвучки");
  elevenKey();
  for (const job of listVoiceJobs(episodeId)) {
    if (job.status !== "pending" && job.status !== "running") continue;
    if (!isInterrupted(job)) throw new Error("Озвучка уже идёт — дождитесь её");
    writeJson(jobFile(episodeId, job.id), { ...job, status: "error", error: interruptedText(job), finishedAt: new Date().toISOString() });
  }
  const kind = options.kind === "isolate" ? "isolate" : "voice";
  const plan =
    kind === "isolate"
      ? planIsolation(episodeId, characters).map((item) => ({ ...item, chars: 0 }))
      : await planVoices(episodeId, characters);
  const now = new Date();
  const job: VoiceJob = {
    id: `voice-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`,
    episodeId,
    characters: plan.map((item) => item.character),
    kind,
    status: "pending",
    chars: plan.reduce((sum, item) => sum + item.chars, 0),
    isolationChars: plan.reduce((sum, item) => sum + item.isolationChars, 0),
    allowPaid: true,
    createdAt: now.toISOString(),
    results: [],
  };
  active().add(job.id);
  writeJson(jobFile(episodeId, job.id), job);
  return job;
}

/** Выполняет поставленное задание. Маршрут вызывает его без ожидания; тесты — с ожиданием. */
export async function runVoiceJob(episodeId: string, id: string): Promise<VoiceJob> {
  const file = jobFile(episodeId, id);
  let job = readJson<VoiceJob>(file);
  if (!job) throw new Error(`Нет задания ${id}`);
  if (job.status !== "pending") return job;
  active().add(id);
  const save = (patch: Partial<VoiceJob>) => {
    job = { ...job!, ...patch };
    writeJson(file, job);
  };
  save({ status: "running", startedAt: new Date().toISOString(), pid: process.pid });
  try {
    const { lines } = await readPostLines(episodeId);
    for (const character of job.characters) {
      const onProgress = (progress: string) => save({ progress });
      const version =
        job.kind === "isolate"
          ? await isolateCurrentVoice(episodeId, character, onProgress)
          : await generateCharacterVoice(
              episodeId,
              character,
              lines.filter((line) => line.character.toLowerCase() === character.toLowerCase()),
              onProgress,
            );
      save({
        results: [
          ...job.results,
          {
            character,
            version: version.version,
            ...(version.isolation ? { isolation: version.isolation.status } : {}),
            ...(version.isolation?.error ? { isolationError: version.isolation.error } : {}),
          },
        ],
      });
    }
    // Таблица реплик на диске — по текущим speech.md (правки доски сохраняются).
    writePostLines(episodeId, lines);
    save({ status: "done", progress: undefined, finishedAt: new Date().toISOString() });
  } catch (error) {
    save({ status: "error", error: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() });
  } finally {
    active().delete(id);
  }
  return job;
}
