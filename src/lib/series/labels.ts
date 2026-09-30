import type { StageStatus } from "./constants";

export function statusTone(status: StageStatus): string {
  switch (status) {
    case "approved":
      return "bg-emerald-500/15 text-emerald-800 border-emerald-500/30";
    case "review":
      return "bg-amber-500/15 text-amber-900 border-amber-500/30";
    case "waiting":
      return "bg-sky-500/15 text-sky-900 border-sky-500/30";
    case "prep":
      return "bg-teal-500/15 text-teal-900 border-teal-500/30";
    default:
      return "bg-stone-500/10 text-stone-600 border-stone-400/30";
  }
}
