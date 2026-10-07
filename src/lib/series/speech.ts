import fs from "fs";
import path from "path";
import type { StageId } from "./constants";
import { readTextIfExists } from "./media";
import { shotDir } from "./paths";

/**
 * `shots/{shotId}/speech.md` — прямая речь кадра: что персонажи говорят вслух, дословно.
 * Одна реплика на строку, можно с именем: `Катя: Мама, я дома.` Пусто — в кадре молчат.
 * Один файл на кадр: реплики нужны и превью (темп, движение губ), и финалу (звук MiniMax H3).
 * Пишет доска (PATCH этапа, поле `speech`) и пользователь. В модель напрямую не идёт: агент переносит реплики в prompt.md.
 */
export const SPEECH_FILE = "speech.md";

/** Этапы, на странице которых есть поле «Реплики». */
export const SPEECH_STAGES: readonly StageId[] = ["video_preview", "final_render"];

export function stageHasSpeech(stageId: StageId): boolean {
  return SPEECH_STAGES.includes(stageId);
}

export function readShotSpeech(episodeId: string, shotId: string): string {
  return readTextIfExists(path.join(shotDir(episodeId, shotId), SPEECH_FILE));
}

/** Пустой текст удаляет файл: «персонаж молчит» — это отсутствие реплик. */
export function writeShotSpeech(episodeId: string, shotId: string, text: string): void {
  const file = path.join(shotDir(episodeId, shotId), SPEECH_FILE);
  if (!text.trim()) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

/**
 * Реплики без имени говорящего и кавычек: `Катя: «Мама, я дома.»` → `Мама, я дома.`
 * По ним проверка языка prompt.md пропускает дословные реплики (они могут быть по-русски).
 */
export function speechPhrases(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*[-*]\s+/, "")
        .replace(/^[^:«"„“]{1,40}:\s*/, "")
        .trim()
        .replace(/^[«"„“]+|[»"“”]+$/g, "")
        .trim(),
    )
    .filter(Boolean);
}
