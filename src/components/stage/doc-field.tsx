"use client";

import type { ReactNode } from "react";
import { useT } from "@/components/language";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { hasDiskConflict, type FieldState } from "./use-stage-detail";

export function DocFieldLabel({
  children,
  optional,
  note,
  htmlFor,
}: {
  children: ReactNode;
  optional?: boolean;
  note?: string;
  htmlFor?: string;
}) {
  const t = useT();
  const hint = [note, optional ? t("doc.optional") : ""].filter(Boolean).join(" · ");
  return (
    <label
      htmlFor={htmlFor}
      className="flex flex-wrap items-baseline gap-x-2 text-xs font-medium text-stone-600"
    >
      <span>{children}</span>
      {hint ? <span className="font-normal text-stone-400">{hint}</span> : null}
    </label>
  );
}

/**
 * Поле документа этапа. Показывает «изменено» и плашку, если файл на диске
 * изменился, пока поле правили.
 */
export function DocTextarea({
  id,
  field,
  disk,
  onChange,
  onPull,
  onKeep,
  readOnly,
  placeholder,
  className,
}: {
  id: string;
  field: FieldState;
  disk: string;
  onChange: (value: string) => void;
  onPull: () => void;
  onKeep: () => void;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const t = useT();
  const conflict = hasDiskConflict(field, disk);
  return (
    <div className="space-y-1.5">
      <Textarea
        id={id}
        value={field.value}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(readOnly && "bg-stone-50 text-stone-600", className)}
      />
      {conflict ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <span>{t("doc.conflict")}</span>
          <button type="button" className="font-medium underline" onClick={onPull}>
            {t("doc.pull")}
          </button>
          <button type="button" className="text-amber-800 underline" onClick={onKeep}>
            {t("doc.keep")}
          </button>
        </div>
      ) : field.dirty ? (
        <p className="text-[11px] text-stone-400">{t("doc.dirty")}</p>
      ) : null}
    </div>
  );
}
