"use client";

import { useT } from "@/components/language";
import type { Translate } from "@/lib/i18n";
import type { MediaFile } from "@/lib/series/types";
import { MediaCard } from "./media-card";

function subjectKey(filename: string, shotId: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  const shotSuffix = `_${shotId}`;
  if (base.endsWith(shotSuffix)) return base.slice(0, -shotSuffix.length);
  const cut = base.indexOf("_");
  return cut === -1 ? base : base.slice(0, cut);
}

function refRole(filename: string, tr: Translate): string {
  const base = filename.replace(/\.[^.]+$/, "");
  if (base.endsWith("_outfit")) return tr("refs.role.outfit");
  if (base.endsWith("_pose")) return tr("refs.role.pose");
  if (base.endsWith("_face")) return tr("refs.role.face");
  return tr("refs.role.file");
}

/** refs/, относящиеся к выбранным (или всем) вариантам в output/: по имени персонажа. */
export function usedRefNames(
  refs: MediaFile[],
  output: MediaFile[],
  selectedOutput: string[],
  shotId: string,
): string[] {
  const picked = selectedOutput.length
    ? output.filter((file) => selectedOutput.includes(file.name))
    : output;
  const subjects = new Set(picked.map((file) => subjectKey(file.name, shotId)));
  return refs
    .filter((file) => subjects.has(subjectKey(file.name, shotId)))
    .map((file) => file.name);
}

export function RefFiles({
  files,
  selectedName,
  usedNames,
  onSelect,
  onOpen,
  excluded,
  onToggleExclude,
}: {
  files: MediaFile[];
  selectedName: string | null;
  usedNames: string[];
  onSelect: (name: string) => void;
  onOpen: (file: MediaFile) => void;
  /** Убранные из графа файлы этапа (MediaFile.relativePath). */
  excluded: string[];
  /** Убрать из графа (true) или вернуть (false). Нет — этап занят. */
  onToggleExclude?: (file: MediaFile, exclude: boolean) => void;
}) {
  const t = useT();
  const removed = new Set(excluded);
  const selected = files.find((file) => file.name === selectedName) ?? null;
  const used = new Set(usedNames);

  if (!files.length) {
    return <p className="text-sm text-stone-500">{t("refs.empty")}</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-stone-500">
        {selected
          ? t("refs.openOne", { role: refRole(selected.name, t), name: selected.name })
          : usedNames.length
            ? t("refs.usedList", { names: usedNames.join(", ") })
            : t("refs.hint")}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {files.map((file) => (
          <MediaCard
            key={file.relativePath}
            file={file}
            selected={file.name === selectedName}
            onSelect={() => onSelect(file.name)}
            onOpen={() => onOpen(file)}
            excluded={removed.has(file.relativePath)}
            onToggleExclude={
              onToggleExclude ? () => onToggleExclude(file, !removed.has(file.relativePath)) : undefined
            }
            caption={`${refRole(file.name, t)}${used.has(file.name) ? t("refs.used") : ""}`}
          />
        ))}
      </div>
    </div>
  );
}
