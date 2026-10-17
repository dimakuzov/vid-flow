"use client";

import { useT } from "@/components/language";
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
  const t = useT();
  if (!versions.length) {
    return (
      <details className="text-xs text-stone-500">
        <summary className="cursor-pointer">{t("history.title")}</summary>
        <p className="mt-2">{t("history.current")}</p>
      </details>
    );
  }
  return (
    <details className="text-xs text-stone-500">
      <summary className="cursor-pointer">{t("history.count", { n: versions.length })}</summary>
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
                {version.prompt.trim().split("\n")[0] || t("history.empty")}
              </div>
            </div>
            <Button variant="outline" disabled={disabled} onClick={() => onRestore(version.id)}>
              {t("history.restore")}
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
