import path from "path";
import type { GraphBinding, ImageInput } from "../contracts/graph-binding";
import type { StageId } from "../series/constants";
import { characterClothingFiles, missingCharacterBase, tooManyClothingRefs } from "../series/character-base";
import { readTextIfExists } from "../series/media";
import { stageDir, toPosix } from "../series/paths";
import { readShotMeta } from "../series/shot-meta";
import { assertStageFree, readStageStateFile, writeStageState } from "../series/stage-state";
import { readRunSettings } from "../series/run-settings";
import { buildPrompt, resolveImageInput, splitSections, type BuiltPrompt, type ShotContext } from "./binding";
import { characterJobId, enqueueComfyJob, startComfyQueue } from "./queue";
import { requireStageBinding, resolveWorkflowId } from "./workflows";

function relativeToCwd(absolute: string): string {
  return toPosix(path.relative(process.cwd(), absolute));
}

/**
 * Ставит прогон этапа в очередь по манифесту графа (docs/contracts/graph-binding.md).
 * workflow — id манифеста или старое имя (`i2v`, `flf`); пусто — выбор этапа (run_settings.json),
 * иначе вариант по умолчанию. Манифест с forEach character — по заданию на персонажа.
 */
export function queueStageRun(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  options?: {
    workflow?: string | null;
    fromAgent?: boolean;
    /** Разрешение пользователя на платный запуск в Comfy Cloud — на этот один запуск. */
    allowCloud?: boolean;
  },
): { id: string; message: string } {
  // Ручной запуск закрыт, пока идёт операция. Из цикла после ответа агента — разрешён.
  if (!options?.fromAgent) assertStageFree(episodeId, shotId, stageId);
  const workflow = resolveWorkflowId(
    episodeId,
    shotId,
    stageId,
    options?.workflow || readRunSettings(episodeId, shotId, stageId).workflow,
  );
  if (!workflow) {
    throw new Error(
      `У этапа ${stageId} нет воркфлоу доски (манифеста в playbooks/workflows/comfy/), доска его не запускает. Прогон делает агент по плейбуку этапа.`,
    );
  }
  const { binding, graph } = requireStageBinding(stageId, workflow);
  if (binding.target === "cloud" && !options?.allowCloud) {
    throw new Error(
      `«${binding.label}» идёт в Comfy Cloud и тратит кредиты. Поставьте галочку «Разрешить платную отправку в Comfy Cloud» на странице этапа и нажмите «Запустить».`,
    );
  }
  const ctx: ShotContext = { episodeId, shotId, stageId };
  assertFireredRefLimit(binding, ctx);
  const queued =
    binding.forEach === "character"
      ? queueCharacters(binding, graph, ctx)
      : [enqueueBuilt(binding, ctx, `${shotId}-${binding.id}-${Date.now()}`, buildPrompt(binding, graph, ctx))];
  const previous = readStageStateFile(episodeId, shotId, stageId);
  writeStageState(episodeId, shotId, stageId, {
    phase: "comfy",
    jobId: queued[0].id,
    jobIds: queued.map((job) => job.id),
    requestId: options?.fromAgent ? previous?.requestId : undefined,
  });
  startComfyQueue();
  const cloud = binding.target === "cloud";
  const ids = queued.map((job) => job.id).join(", ");
  const lead = cloud
    ? `Отправляется в Comfy Cloud: ${ids}. Файлы появятся в output/, когда облако закончит.`
    : `В очереди Comfy: ${ids}. Прогон идёт там, файлы появятся в output/.`;
  const notes = queued.flatMap((job) => job.note ?? []);
  return { id: queued[0].id, message: [lead, ...notes].filter(Boolean).join(" ") };
}

interface Queued {
  id: string;
  note?: string[];
}

/** FireRed берёт 1–3 картинки из refs/. Четвёртая — ошибка, а не тихий обрез. */
function assertFireredRefLimit(binding: GraphBinding, ctx: ShotContext): void {
  if (binding.id !== "location_firered") return;
  const input = binding.inputs.refs;
  if (!input || input.kind !== "image" || input.max == null) return;
  const files = resolveImageInput(ctx, { ...input, max: undefined });
  if (files.length > input.max) {
    throw new Error(
      `В этот граф идёт не больше ${input.max} референсов. Сейчас ${files.length}. Лишние уберите из графа кнопкой «Убрать».`,
    );
  }
}

/** Вход базы персонажа: источник library:character. Нет его — базу перед прогоном не проверяем. */
function characterBaseInput(binding: GraphBinding): ImageInput | null {
  for (const input of Object.values(binding.inputs)) {
    if (input.kind !== "image") continue;
    const sources = Array.isArray(input.from) ? input.from : [input.from];
    if (sources.includes("library:character")) return input;
  }
  return null;
}

function enqueueBuilt(binding: GraphBinding, ctx: ShotContext, id: string, built: BuiltPrompt): Queued {
  const job = enqueueComfyJob({
    id,
    status: "pending",
    episodeId: ctx.episodeId,
    shotId: ctx.shotId,
    stageId: ctx.stageId,
    workflow: binding.id,
    ...(binding.target === "cloud" ? { target: "cloud" as const } : {}),
    prompt: built.prompt,
    uploads: built.uploads.map((upload) => ({ path: relativeToCwd(upload.path), filename: upload.filename })),
    saveTo: relativeToCwd(path.join(stageDir(ctx.episodeId, ctx.shotId, ctx.stageId), "output")),
  });
  return { id: job.id };
}

/**
 * По прогону на персонажа. Пустой раздел и персонаж без базы не ставятся.
 * Нет образца одежды — прогон идёт, нода image 2 в bypass. Нет ни одного — ошибка.
 */
function queueCharacters(
  binding: GraphBinding,
  graph: Parameters<typeof buildPrompt>[1],
  ctx: ShotContext,
): Queued[] {
  const names = readShotMeta(ctx.episodeId, ctx.shotId).characters;
  if (!names.length) throw new Error("В кадре нет персонажей.");
  const prompt = readTextIfExists(path.join(stageDir(ctx.episodeId, ctx.shotId, ctx.stageId), "prompt.md")).trim();
  if (!prompt) {
    throw new Error("В prompt.md нет текста для модели. Отправь рекомендацию агенту или впиши промпт сам.");
  }
  const allowed = names.map((name) => name.toLowerCase());
  const parts = splitSections(prompt, allowed);
  if (!parts) {
    throw new Error(`prompt.md: нужны разделы ## ${allowed.join(", ")}. Пустой раздел — персонаж не перегенерируется.`);
  }
  const base = characterBaseInput(binding);
  const stamp = Date.now();
  const skipped: string[] = [];
  // Сначала собрать все промпты: ошибка текста не оставляет уже поставленное задание.
  const prepared: { id: string; ctx: ShotContext; built: BuiltPrompt }[] = [];
  for (const name of names) {
    const section = parts.get(name.toLowerCase()) ?? "";
    if (!section.trim()) continue;
    const run: ShotContext = { ...ctx, character: name };
    if (base && !resolveImageInput(run, base).length) {
      skipped.push(missingCharacterBase(name));
      continue;
    }
    const clothes = characterClothingFiles(ctx.episodeId, ctx.shotId, ctx.stageId, name);
    if (clothes.length > 1) throw new Error(tooManyClothingRefs(name, clothes.length));
    prepared.push({
      id: characterJobId(ctx.shotId, binding.id, name, stamp),
      ctx: run,
      built: buildPrompt(binding, graph, run),
    });
  }
  if (!prepared.length) {
    throw new Error(skipped.join(" ") || "Нечего запускать: в prompt.md нет текста для персонажей кадра.");
  }
  const queued = prepared.map((item) => enqueueBuilt(binding, item.ctx, item.id, item.built));
  if (skipped.length) queued[0].note = skipped;
  return queued;
}
