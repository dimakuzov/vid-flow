import { STATUS_LABELS, type StageStatus } from "@/lib/series/constants";
import { statusTone } from "@/lib/series/labels";
import { cn } from "@/lib/utils";

export function StatusPill({ status }: { status: StageStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide",
        statusTone(status),
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
