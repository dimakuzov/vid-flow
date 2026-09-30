export const STAGES = [
  "characters",
  "location",
  "first_frame",
  "video_preview",
  "final_render",
] as const;

export type StageId = (typeof STAGES)[number];

export const STAGE_LABELS: Record<StageId, string> = {
  characters: "Персонажи",
  location: "Локация",
  first_frame: "Первый кадр",
  video_preview: "Видео (превью)",
  final_render: "Финальный рендер",
};

export const STAGE_DOCS = [
  "prompt.md",
  "llm_notes.md",
  "refs.md",
  "workflow.md",
  "status.json",
] as const;

export type StageStatus =
  | "empty"
  | "prep"
  | "waiting"
  | "review"
  | "approved";

export const STATUS_LABELS: Record<StageStatus, string> = {
  empty: "Пусто",
  prep: "Подготовка",
  waiting: "Ожидание",
  review: "На проверке",
  approved: "Утверждено",
};

export const MEDIA_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
]);
