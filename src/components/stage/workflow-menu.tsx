"use client";

import type { WorkflowChoice } from "@/lib/series/types";

/** Воркфлоу, который уйдёт в запуск: выбор этапа или вариант по умолчанию. */
export function effectiveWorkflow(
  workflows: WorkflowChoice[],
  selected: string | null,
): WorkflowChoice | null {
  return (
    workflows.find((item) => item.id === selected) ??
    workflows.find((item) => item.isDefault) ??
    workflows[0] ??
    null
  );
}

function optionText(choice: WorkflowChoice): string {
  return choice.available ? choice.label : `${choice.label} — нет: ${choice.missing.join(", ")}`;
}

/**
 * Меню воркфлоу этапа (`StageDetail.workflows`). Значение `""` — вариант по умолчанию.
 * Недоступные варианты выбрать можно (входы могут появиться позже), подпись говорит, чего нет.
 */
export function WorkflowMenu({
  id,
  workflows,
  selected,
  disabled,
  onSelect,
}: {
  id: string;
  workflows: WorkflowChoice[];
  selected: string | null;
  disabled?: boolean;
  onSelect: (workflowId: string) => void;
}) {
  if (!workflows.length) return null;
  const fallback = workflows.find((item) => item.isDefault) ?? workflows[0];
  const current = effectiveWorkflow(workflows, selected);
  const value = selected && workflows.some((item) => item.id === selected) ? selected : "";

  return (
    <div className="grid min-w-0 gap-1 text-xs text-stone-600">
      <label htmlFor={id}>Воркфлоу</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
        className="h-9 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 text-sm text-stone-900 disabled:opacity-60"
      >
        <option value="">По умолчанию: {fallback.label}</option>
        {workflows.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {optionText(choice)}
          </option>
        ))}
      </select>
      {current ? (
        <p className="leading-5 text-stone-500">
          {current.description}
          {current.available ? null : (
            <span className="text-amber-800"> Не хватает: {current.missing.join(", ")}.</span>
          )}
        </p>
      ) : null}
    </div>
  );
}

/** Предложение агента (`agentRequest.suggestedWorkflow`), если оно отличается от выбора. */
export function SuggestedWorkflow({
  workflows,
  selected,
  suggested,
  disabled,
  onSwitch,
}: {
  workflows: WorkflowChoice[];
  selected: string | null;
  suggested: string | null | undefined;
  disabled?: boolean;
  onSwitch: (workflowId: string) => void;
}) {
  if (!suggested) return null;
  const current = effectiveWorkflow(workflows, selected);
  if (current?.id === suggested) return null;
  const choice = workflows.find((item) => item.id === suggested);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-xs text-violet-950">
      <span>
        Агент предлагает: <b>{choice?.label ?? suggested}</b>
        {choice && !choice.available ? ` (нет: ${choice.missing.join(", ")})` : ""}
      </span>
      {choice ? (
        <button
          type="button"
          className="font-medium underline disabled:opacity-50"
          disabled={disabled}
          onClick={() => onSwitch(choice.id)}
        >
          Переключить
        </button>
      ) : null}
    </div>
  );
}
