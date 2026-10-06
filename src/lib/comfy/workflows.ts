import type { ApiPrompt } from "../contracts/comfy-job";
import type { GraphBinding, WorkflowChoice } from "../contracts/graph-binding";
import type { StageId } from "../series/constants";
import { missingInputs, stageBindings, type LoadedBinding } from "./binding";

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
  const choices = stageBindings(stageId).map((item): WorkflowChoice => {
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
    };
  });
  const fallback = choices.find((choice) => choice.available) ?? choices[0];
  if (fallback) fallback.isDefault = true;
  return choices;
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
