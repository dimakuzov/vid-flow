import { readLang, t } from "@/lib/i18n";

/** Пути API и запросы, общие для страницы этапа и меню клетки. */

export function shotApiPath(episodeId: string, shotId: string): string {
  return `/api/episodes/${encodeURIComponent(episodeId)}/shots/${encodeURIComponent(shotId)}`;
}

export function stageApiPath(episodeId: string, shotId: string, stageId: string): string {
  return `${shotApiPath(episodeId, shotId)}/stages/${encodeURIComponent(stageId)}`;
}

export function stagePagePath(episodeId: string, shotId: string, stageId: string): string {
  return `/e/${encodeURIComponent(episodeId)}/shots/${encodeURIComponent(shotId)}/${encodeURIComponent(stageId)}`;
}

export function episodePagePath(episodeId: string, shotId?: string): string {
  const base = `/e/${encodeURIComponent(episodeId)}`;
  return shotId ? `${base}?shot=${encodeURIComponent(shotId)}` : base;
}

/** JSON-запрос. Ошибка сервера (`{ error }`) превращается в исключение с её текстом. */
export async function requestJson<T>(
  url: string,
  init: { method?: string; body?: unknown; fallbackError?: string } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    cache: "no-store",
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const text =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : init.fallbackError || t(readLang(), "common.httpError", { status: res.status });
    throw new Error(text);
  }
  return data as T;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : t(readLang(), "common.error");
}
