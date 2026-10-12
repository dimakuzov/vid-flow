"use client";

import { Button } from "@/components/ui/button";
import type { StageDetail } from "@/lib/series/types";

export function PromptHistory({
  versions,
  disabled,
  onRestore,
}: {
  versions: StageDetail["promptHistory"];
  disabled: boolean;
  onRestore: (versionId: string) => void;
}) {
  if (!versions.length) {
    return (
      <details className="text-xs text-stone-500">
        <summary className="cursor-pointer">Прошлые версии промпта</summary>
        <p className="mt-2">
          Это текущий промпт. Следующая сохранённая правка оставит его в списке, и его можно будет
          вернуть.
        </p>
      </details>
    );
  }
  return (
    <details className="text-xs text-stone-500">
      <summary className="cursor-pointer">Прошлые версии промпта ({versions.length})</summary>
      <ul className="mt-2 space-y-2">
        {versions.map((version) => (
          <li
            key={version.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-[11px] text-stone-400">
                {version.savedAt.slice(0, 16).replace("T", " ")}
              </div>
              <div className="truncate text-xs text-stone-600">
                {version.prompt.trim().split("\n")[0] || "(пустой промпт)"}
              </div>
            </div>
            <Button variant="outline" disabled={disabled} onClick={() => onRestore(version.id)}>
              Вернуть
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
