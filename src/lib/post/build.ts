import { readComfyJob } from "../comfy/queue";
import { listShotIds } from "../series/paths";
import { readShotFinal } from "./lines";
import { enqueueSpeechDetect, readSpeechDetect } from "./speech-detect";
import { buildTimeline, type Manifest, type TimelineOptions } from "./timeline";

/*
 * «Собрать проект»: сначала речь в финалах (Whisper через очередь ComfyUI) — для кадров, где её
 * ещё не распознавали, распознавание упало или финал заменили; ждём, пока ComfyUI закончит;
 * потом сборка (Kdenlive + FCPXML). Кадры, которые не успели или упали, собираются без подгонки
 * под губы — с заметкой в предупреждениях.
 */

export interface BuildOptions extends TimelineOptions {
  /** Сколько всего ждать распознавание, мс (по умолчанию 20 мин). */
  timeoutMs?: number;
  /** Задание так и не ушло в ComfyUI (выключен?) дольше этого — не ждём его, мс (по умолчанию 90 с). */
  stallMs?: number;
  pollMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ждёт распознавание кадров. Ответ — заметки о кадрах, где речи нет. */
export async function waitForSpeech(episodeId: string, options: BuildOptions = {}): Promise<string[]> {
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;
  const stallMs = options.stallMs ?? 90_000;
  const pollMs = options.pollMs ?? 2000;
  const started = Date.now();
  const finals = new Map(await Promise.all(listShotIds(episodeId).map(async (shotId) => [shotId, await readShotFinal(episodeId, shotId)] as const)));
  const audible = [...finals.values()].filter((final) => final.probe?.hasAudio).map((final) => final.shotId);
  const given = new Set<string>();
  for (;;) {
    const waiting: string[] = [];
    for (const shotId of audible) {
      if (given.has(shotId)) continue;
      const speech = readSpeechDetect(episodeId, shotId, finals.get(shotId) ?? null);
      if (speech.status !== "queued" && speech.status !== "running") continue;
      const job = speech.jobId ? readComfyJob(speech.jobId) : null;
      const neverSent = job?.status === "pending" && !job.submittedAt;
      const queuedAt = job?.queuedAt ? Date.parse(job.queuedAt) : started;
      if (neverSent && Date.now() - Math.max(queuedAt, started) > stallMs) {
        given.add(shotId);
        continue;
      }
      waiting.push(shotId);
    }
    if (!waiting.length || Date.now() - started > timeoutMs) break;
    await sleep(pollMs);
  }
  const notes: string[] = [];
  for (const shotId of audible) {
    const speech = readSpeechDetect(episodeId, shotId, finals.get(shotId) ?? null);
    if (speech.status === "done") continue;
    if (speech.status === "queued" || speech.status === "running") {
      notes.push(
        given.has(shotId)
          ? `${shotId}: распознавание речи не ушло в ComfyUI (запущен ли он?) — кадр собран без подгонки под губы`
          : `${shotId}: распознавание речи не успело — кадр собран без подгонки под губы, соберите проект ещё раз позже`,
      );
    } else {
      notes.push(`${shotId}: речь не распознана${speech.error ? ` (${speech.error})` : ""} — кадр собран без подгонки под губы`);
    }
  }
  return notes;
}

export async function buildProject(episodeId: string, options: BuildOptions = {}): Promise<Manifest> {
  const notes: string[] = [];
  try {
    await enqueueSpeechDetect(episodeId);
    notes.push(...(await waitForSpeech(episodeId, options)));
  } catch (error) {
    notes.push(`Распознавание речи не запустилось: ${error instanceof Error ? error.message : String(error)} — проект собран без подгонки под губы`);
  }
  return buildTimeline(episodeId, { width: options.width, height: options.height, notes });
}
