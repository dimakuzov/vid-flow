import path from "path";
import type { ApiPrompt } from "../contracts/comfy-job";
import type { GraphBinding, WorkflowChoice } from "../contracts/graph-binding";
import type { StageId } from "../series/constants";
import { readShotSpeech, speechSpeakers } from "../series/speech";
import { missingInputs, readVideoPromptText, resolveImageInput, stageBindings, type LoadedBinding } from "./binding";

/*
 * Воркфлоу этапа для меню и для запуска (docs/contracts/graph-binding.md):
 * манифесты `playbooks/workflows/comfy/*.bind.json` этого этапа по order.
 */

/** Варианты этапа по order. Пустой список — доска этот этап не запускает. */
export function listWorkflowChoices(
  episodeId: string,
  shotId: string,
  stageId: StageId,
): WorkflowChoice[] {
  const loaded = stageBindings(stageId);
  const choices = loaded.map((item): WorkflowChoice => {
    const binding = item.binding!;
    // Сломанный манифест виден в меню, но недоступен: причина — в missing.
    const missing = item.error ? [item.error] : missingInputs({ episodeId, shotId, stageId }, binding);
    return {
      id: item.id,
      label: binding.label || item.id,
      description: binding.description || "",
      available: missing.length === 0,
      missing,
      isDefault: false,
      playbook: binding.playbook ?? null,
      cloud: binding.target === "cloud" && binding.cost ? binding.cost : null,
    };
  });
  // Сначала эскиз: whenSketch важнее реплик (эскиз LTX → финал LTX, даже если в кадре говорят).
  // Нет совпадения — defaultWhen: реплики есть — `speech`, говорящих двое и больше — ещё и
  // `dialogue`, реплик нет — `silent`. Подходящего доступного нет — первый доступный.
  const sketch = choices.find((choice, index) => choice.available && sketchMatches(episodeId, shotId, stageId, loaded[index].binding));
  const speech = readShotSpeech(episodeId, shotId);
  const speaks = speech.trim().length > 0;
  const dialogue = speechSpeakers(speech).length >= 2;
  const fits = (index: number) => {
    const when = loaded[index].binding?.defaultWhen;
    if (!when) return true;
    if (when === "silent") return !speaks;
    if (when === "dialogue") return dialogue;
    return speaks;
  };
  const fallback =
    sketch ??
    choices.find((choice, index) => choice.available && fits(index)) ??
    choices.find((choice) => choice.available) ??
    choices[0];
  if (fallback) fallback.isDefault = true;
  return choices;
}

/**
 * Утверждённый ролик сделан графом из whenSketch. Метаданные важнее имени файла:
 * файл могли переименовать. Имя — только когда ключа prompt в контейнере нет.
 */
function sketchMatches(episodeId: string, shotId: string, stageId: StageId, binding: GraphBinding | null): boolean {
  const match = binding?.whenSketch;
  if (!match) return false;
  const input = binding?.inputs[match.of];
  if (!input || input.kind !== "video") return false;
  const file = resolveImageInput({ episodeId, shotId, stageId }, input)[0];
  if (!file) return false;
  const read = readVideoPromptText(file, match.nodes);
  if (read.metadata) return read.text != null;
  return Boolean(match.filename && path.basename(file).includes(match.filename));
}

function findByName(stageId: StageId, raw: string): LoadedBinding | undefined {
  const bindings = stageBindings(stageId);
  return (
    bindings.find((item) => item.id === raw) ??
    bindings.find((item) => item.binding?.aliases?.includes(raw))
  );
}

/**
 * id манифеста по выбору пользователя: точный id или старое имя (`i2v`, `flf`).
 * Пусто — вариант по умолчанию. Неизвестное имя — ошибка. Этап без манифестов — null.
 */
export function resolveWorkflowId(
  episodeId: string,
  shotId: string,
  stageId: StageId,
  requested?: string | null,
): string | null {
  const raw = requested?.trim();
  if (!raw) {
    return listWorkflowChoices(episodeId, shotId, stageId).find((choice) => choice.isDefault)?.id ?? null;
  }
  const found = findByName(stageId, raw);
  if (found) return found.id;
  if (!stageBindings(stageId).length) return null;
  throw new Error(`Воркфлоу «${raw}» нет у этапа ${stageId}`);
}

/** Загруженный манифест этапа по id. Сломанный — ошибка с его причиной. */
export function requireStageBinding(stageId: StageId, id: string): { binding: GraphBinding; graph: ApiPrompt } {
  const found = stageBindings(stageId).find((item) => item.id === id);
  if (!found) throw new Error(`Воркфлоу «${id}» нет у этапа ${stageId}`);
  if (found.error || !found.binding || !found.graph) throw new Error(found.error || `Манифест ${id} не загрузился`);
  return { binding: found.binding, graph: found.graph };
}
