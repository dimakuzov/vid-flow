import fs from "fs";
import path from "path";
import type { WorkflowChoice } from "../contracts/graph-binding";
import type { StageId } from "../series/constants";
import { stageDir } from "../series/paths";

/*
 * Воркфлоу этапа для меню и для запуска (docs/contracts/graph-binding.md).
 *
 * ВРЕМЕННО: список повторяет то, что сейчас захардкожено в stage-run.ts.
 * Модуль 3 (бриф 3) заменяет тело на чтение `playbooks/workflows/comfy/*.bind.json`,
 * не меняя сигнатуры: на них уже опираются scanner (StageDetail.workflows),
 * маршрут запуска и связь с агентом.
 */

interface StaticWorkflow {
  id: string;
  stage: StageId;
  label: string;
  description: string;
  order: number;
  aliases?: string[];
  needs: Array<{ label: string; ok: (episodeId: string, shotId: string) => boolean }>;
}

const IMAGE = /\.(png|jpe?g|webp)$/i;

function hasImage(dir: string): boolean {
  try {
    return fs.readdirSync(dir).some((name) => IMAGE.test(name));
  } catch {
    return false;
  }
}

const approved = (stage: StageId, label: string) => ({
  label,
  ok: (episodeId: string, shotId: string) =>
    hasImage(path.join(stageDir(episodeId, shotId, stage), "approve")),
});

const refsOf = (stage: StageId, label: string) => ({
  label,
  ok: (episodeId: string, shotId: string) =>
    hasImage(path.join(stageDir(episodeId, shotId, stage), "refs")),
});

const STATIC: StaticWorkflow[] = [
  {
    id: "location_views",
    stage: "location",
    label: "Локация: 4 ракурса по общему виду",
    description: "Общий вид локации без людей, четыре варианта ракурса.",
    order: 10,
    needs: [],
  },
  {
    id: "first_frame_compositing",
    stage: "first_frame",
    label: "Первый кадр: персонажи в локации",
    description: "Вписать утверждённых персонажей (1–2) в утверждённую локацию.",
    order: 10,
    needs: [
      approved("location", "Утверждённая локация"),
      approved("characters", "Утверждённые персонажи"),
    ],
  },
  {
    id: "video_i2v",
    stage: "video_preview",
    label: "Видео от первого кадра (i2v)",
    description: "Движение от утверждённого первого кадра.",
    order: 10,
    aliases: ["i2v"],
    needs: [approved("first_frame", "Утверждённый первый кадр")],
  },
  {
    id: "video_flf",
    stage: "video_preview",
    label: "Видео между первым и последним кадром (FLF)",
    description: "Переход от первого кадра к последнему из refs/.",
    order: 20,
    aliases: ["flf"],
    needs: [
      approved("first_frame", "Утверждённый первый кадр"),
      refsOf("video_preview", "Последний кадр в refs/"),
    ],
  },
  {
    id: "final_i2v",
    stage: "final_render",
    label: "Финал от первого кадра (i2v, как превью)",
    description: "Пока тот же граф, что и превью.",
    order: 10,
    aliases: ["i2v"],
    needs: [approved("first_frame", "Утверждённый первый кадр")],
  },
  {
    id: "final_flf",
    stage: "final_render",
    label: "Финал между кадрами (FLF, как превью)",
    description: "Пока тот же граф, что и превью.",
    order: 20,
    aliases: ["flf"],
    needs: [
      approved("first_frame", "Утверждённый первый кадр"),
      refsOf("final_render", "Последний кадр в refs/"),
    ],
  },
];

/** Варианты этапа по order. Пустой список — доска этот этап не запускает. */
export function listWorkflowChoices(
  episodeId: string,
  shotId: string,
  stageId: StageId,
): WorkflowChoice[] {
  const choices = STATIC.filter((item) => item.stage === stageId)
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const missing = item.needs.filter((need) => !need.ok(episodeId, shotId)).map((need) => need.label);
      return {
        id: item.id,
        label: item.label,
        description: item.description,
        available: missing.length === 0,
        missing,
        isDefault: false,
      };
    });
  const fallback = choices.find((choice) => choice.available) ?? choices[0];
  if (fallback) fallback.isDefault = true;
  return choices;
}

/**
 * id манифеста по выбору пользователя: точный id или старое имя (`i2v`, `flf`).
 * Пусто — вариант по умолчанию. Неизвестное имя — ошибка.
 */
export function resolveWorkflowId(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  requested?: string | null,
): string | null {
  const choices = listWorkflowChoices(episodeId, shotId, stageId);
  if (!choices.length) return null;
  const raw = requested?.trim();
  if (!raw) return choices.find((choice) => choice.isDefault)?.id ?? null;
  const exact = choices.find((choice) => choice.id === raw);
  if (exact) return exact.id;
  const alias = STATIC.find((item) => item.stage === stageId && item.aliases?.includes(raw));
  if (alias) return alias.id;
  throw new Error(`Воркфлоу «${raw}» нет у этапа ${stageId}`);
}
