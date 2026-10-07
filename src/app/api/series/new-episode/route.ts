import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { startFormatRun } from "@/lib/agent/format-runner";
import { defaultProviderId, isProviderId } from "@/lib/agent/config";
import { getAgentProvider } from "@/lib/agent/providers";
import { submitFormatRequest } from "@/lib/series/format-request";
import { assertSafeSegment, getScenariosRoot, isInside, normalizeEpisodeId, writeCurrentEpisodeId } from "@/lib/series/paths";

export const runtime = "nodejs";

/**
 * Кнопка «Добавить» в шапке: новая серия из сценария.
 * Тело `{ episodeId, rawText? | scenarioFile?, provider?, model? }`.
 * ollama / claude — доска сама размечает сценарий моделью и собирает таблицу (format_request.json → done);
 * manual — разметка ждёт агента в чате, как кнопка «Отправить на разметку».
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      episodeId?: unknown;
      rawText?: unknown;
      scenarioFile?: unknown;
      provider?: unknown;
      model?: unknown;
    };
    const episodeId = normalizeEpisodeId(typeof body.episodeId === "string" ? body.episodeId : "");

    let raw = typeof body.rawText === "string" ? body.rawText : "";
    if (!raw.trim() && typeof body.scenarioFile === "string" && body.scenarioFile) {
      const root = getScenariosRoot();
      const file = path.join(root, assertSafeSegment(body.scenarioFile, "файл сценария"));
      if (!isInside(root, file) || !fs.existsSync(file)) throw new Error(`Нет сценария ${body.scenarioFile}`);
      raw = fs.readFileSync(file, "utf8");
    }
    if (!raw.trim()) throw new Error("Выбери сценарий из библиотеки или вставь текст");

    const providerRaw = typeof body.provider === "string" && body.provider ? body.provider : defaultProviderId();
    if (!isProviderId(providerRaw)) throw new Error(`Неизвестный агент «${providerRaw}»`);
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    if (providerRaw !== "manual") {
      const provider = getAgentProvider(providerRaw);
      if (!provider.modes.includes("text")) throw new Error(`${provider.label} не умеет разметку текста`);
      const configError = provider.configError?.(model);
      if (configError) throw new Error(configError);
    }

    const submitted = submitFormatRequest(episodeId, raw, { provider: providerRaw, model });
    writeCurrentEpisodeId(submitted.episodeId);
    if (providerRaw !== "manual") void startFormatRun(submitted.episodeId);
    return NextResponse.json({
      episodeId: submitted.episodeId,
      status: submitted.status,
      message:
        providerRaw === "manual"
          ? "Сценарий записан. Разметку сделает агент в чате: она во входящих эпизода."
          : "Сценарий записан, модель размечает его. Таблица появится сама.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось создать серию";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
