import { NextResponse } from "next/server";
import { setBackView, setFraming, setRefNote } from "@/lib/series/first-frame-settings";
import { setStrictFirstFrame } from "@/lib/series/shot-settings";
import { stageDuration } from "@/lib/comfy/binding";
import { resolveWorkflowId } from "@/lib/comfy/workflows";
import { updateStageDocs } from "@/lib/series/mutations";
import { assignShotLocation } from "@/lib/series/library";
import {
  logSettingsChange,
  readRunSettings,
  setCharacterImage,
  setExcluded,
  updateRunSettings,
} from "@/lib/series/run-settings";
import { setShotCharacters } from "@/lib/series/shot-meta";
import { readStatusFile, writeStatusFile } from "@/lib/series/status";
import { assertStageFree } from "@/lib/series/stage-state";
import { stageHasSpeech, writeShotSpeech } from "@/lib/series/speech";
import { parseStageParams, type StageRouteContext } from "@/lib/series/route-params";
import { effectiveWorkflowId, getStageDetail } from "@/lib/series/scanner";
import type { StageId } from "@/lib/series/constants";

export const runtime = "nodejs";

export async function GET(_request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    return NextResponse.json(getStageDetail(episodeId, shotId, stageId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка этапа";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Кто прислал правку: браузер доски шлёт Referer и User-Agent браузера, скрипт и агент — нет. */
function requestOrigin(request: Request): { userAgent: string; referer: string } {
  return {
    userAgent: (request.headers.get("user-agent") ?? "").slice(0, 120),
    referer: request.headers.get("referer") ?? "",
  };
}

/** Длительность из PATCH: пусто — по умолчанию (null), иначе целое в пределах меню воркфлоу. */
function parseDuration(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  workflow: string | null | undefined,
  raw: unknown,
): number | null {
  if (raw === null || (typeof raw === "string" && !raw.trim())) return null;
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("runDuration — целое число секунд или пустая строка");
  }
  const { range } = stageDuration({ episodeId, shotId, stageId }, effectiveWorkflowId(episodeId, shotId, stageId, workflow));
  if (!range) throw new Error("У этого воркфлоу нет выбора длительности");
  if (value < range.min || value > range.max) {
    throw new Error(`Длительность ${value} с вне ${range.min}–${range.max} с`);
  }
  return value;
}

export async function PATCH(request: Request, context: StageRouteContext) {
  try {
    const { episodeId, shotId, stageId } = parseStageParams(await context.params);
    const body = (await request.json()) as {
      prompt?: string;
      llmNotes?: string;
      refs?: string;
      workflow?: string;
      /** Выбор графа (id манифеста). Пустая строка — вернуть вариант по умолчанию. */
      runWorkflow?: string;
      /** Длительность клипа, с (целое в min..max меню). Пустая строка или null — по умолчанию. */
      runDuration?: number | string | null;
      /** Прямая речь кадра (speech.md). Только на видео-этапах, на других игнорируется. */
      speech?: string;
      /** Убрать файл из графа этапа или вернуть (путь как MediaFile.relativePath). Файл не удаляется. */
      exclude?: { path?: string; excluded?: boolean; click?: { trusted?: boolean; detail?: number; at?: string } | null };
      /** Список персонажей кадра. Только этап characters. Пишет строку `- characters:` в shot.md. */
      characters?: string[];
      /** Картинка персонажа в графе (image 1). path пустой — снова база по имени или библиотека. */
      characterImage?: { name?: string; path?: string | null };
      /** Имя папки в data/locations/. Только этап location. Пишет строку `- location:` в shot.md. */
      location?: string;
      /** Дальность персонажа до камеры. Только первый кадр. value null — снова план из текста кадра. */
      framing?: { name?: string; value?: string | null };
      /** Персонаж стоит спиной: портрет в граф не идёт. Только первый кадр. */
      backView?: { name?: string; value?: boolean };
      /** Подпись к файлу refs/ («шлем Лены»). Только первый кадр. Пустой текст — снять. */
      refNote?: { file?: string; text?: string };
      /** Галка кадра «Строго первый кадр». Ставится на превью или финале и действует на оба этапа. */
      strictFirstFrame?: boolean;
    };
    if (typeof body.strictFirstFrame === "boolean") {
      if (stageId !== "video_preview" && stageId !== "final_render") {
        throw new Error("«Строго первый кадр» — только на превью и финале");
      }
      // От галки зависят граф и задача агенту: пока этап работает, её не меняем.
      assertStageFree(episodeId, shotId, stageId);
      setStrictFirstFrame(episodeId, shotId, body.strictFirstFrame);
    }
    if (body.framing || body.refNote || body.backView) {
      if (stageId !== "first_frame") throw new Error("Дальность и подписи референсов — только на первом кадре");
      // Порядок картинок графа зависит от выбора: пока агент или граф работают, его не меняем.
      assertStageFree(episodeId, shotId, stageId);
      if (body.framing) {
        if (typeof body.framing.name !== "string") throw new Error("Не указан персонаж");
        setFraming(episodeId, shotId, body.framing.name, body.framing.value ?? null);
      }
      if (body.backView) {
        if (typeof body.backView.name !== "string") throw new Error("Не указан персонаж");
        setBackView(episodeId, shotId, body.backView.name, body.backView.value === true);
      }
      if (body.refNote) {
        if (typeof body.refNote.file !== "string") throw new Error("Не указан файл");
        setRefNote(episodeId, shotId, body.refNote.file, String(body.refNote.text ?? ""));
      }
    }
    if (typeof body.location === "string") {
      if (stageId !== "location") throw new Error("Локация кадра меняется на этапе локации");
      assertStageFree(episodeId, shotId, stageId);
      assignShotLocation(episodeId, shotId, body.location);
    }
    if (body.characterImage) {
      if (stageId !== "characters") throw new Error("Картинку персонажа выбирают на этапе персонажей");
      assertStageFree(episodeId, shotId, stageId);
      const name = body.characterImage.name;
      if (typeof name !== "string" || !name.trim()) throw new Error("Не указан персонаж");
      const raw = body.characterImage.path;
      const mediaPath = typeof raw === "string" && raw.trim() ? raw.trim() : null;
      setCharacterImage(episodeId, shotId, name, mediaPath);
      logSettingsChange(episodeId, shotId, stageId, { change: "characterImage", name, path: mediaPath, from: requestOrigin(request) });
    }
    if (Array.isArray(body.characters)) {
      if (stageId !== "characters") throw new Error("Список персонажей меняется на этапе персонажей");
      assertStageFree(episodeId, shotId, stageId);
      const names = setShotCharacters(episodeId, shotId, body.characters.map(String));
      const stored = readStatusFile(episodeId, shotId, stageId);
      writeStatusFile(episodeId, shotId, stageId, { ...stored, expectedCharacters: names });
    }
    if (body.exclude) {
      if (typeof body.exclude.path !== "string") throw new Error("Не указан файл");
      // Граф или агент могут как раз читать входы: менять их можно только у свободного этапа.
      assertStageFree(episodeId, shotId, stageId);
      setExcluded(episodeId, shotId, stageId, body.exclude.path, body.exclude.excluded !== false);
      logSettingsChange(episodeId, shotId, stageId, {
        change: body.exclude.excluded !== false ? "exclude" : "restore",
        path: body.exclude.path,
        click: body.exclude.click
          ? { trusted: body.exclude.click.trusted === true, detail: Number(body.exclude.click.detail ?? -1), at: String(body.exclude.click.at ?? "") }
          : null,
        from: requestOrigin(request),
      });
    }
    const patch: { workflow?: string | null; durationSec?: number | null } = {};
    if (typeof body.runWorkflow === "string") {
      patch.workflow = body.runWorkflow.trim()
        ? resolveWorkflowId(episodeId, shotId, stageId, body.runWorkflow)
        : null;
    }
    if (body.runDuration !== undefined) {
      const workflow = patch.workflow !== undefined ? patch.workflow : readRunSettings(episodeId, shotId, stageId).workflow;
      patch.durationSec = parseDuration(episodeId, shotId, stageId, workflow, body.runDuration);
    }
    if (Object.keys(patch).length) updateRunSettings(episodeId, shotId, stageId, patch);
    if (typeof body.speech === "string" && stageHasSpeech(stageId)) writeShotSpeech(episodeId, shotId, body.speech);
    updateStageDocs({
      episodeId,
      shotId,
      stageId,
      prompt: body.prompt,
      llmNotes: body.llmNotes,
      refs: body.refs,
      workflow: body.workflow,
    });
    return NextResponse.json(getStageDetail(episodeId, shotId, stageId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка сохранения";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
