import type { ComfyNodeError } from "../contracts/comfy-job";

export interface ComfyImageRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

export interface ComfyHistory {
  outputs?: Record<
    string,
    { images?: ComfyImageRef[]; gifs?: ComfyImageRef[]; videos?: ComfyImageRef[] }
  >;
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
}

/** ComfyUI отказал: короткий текст для пользователя и ошибки по нодам. */
export class ComfyRejectedError extends Error {
  constructor(
    message: string,
    readonly nodeErrors: ComfyNodeError[] = [],
  ) {
    super(message);
    this.name = "ComfyRejectedError";
  }
}

interface RawNodeError {
  class_type?: string;
  errors?: { type?: string; message?: string; details?: string }[];
}

function describe(item: { message?: string; details?: string }): string {
  const message = (item.message || "").trim();
  const details = (item.details || "").trim();
  if (message && details) return `${message}: ${details}`;
  return message || details || "ошибка";
}

/** node_errors из ответа /prompt → по одной читаемой записи на ноду. */
export function parseNodeErrors(raw: unknown): ComfyNodeError[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, RawNodeError>).map(([node, value]) => ({
    node,
    classType: value?.class_type,
    message: (value?.errors || []).map(describe).join("; ") || "ошибка ноды",
  }));
}

function rejection(data: { error?: unknown; node_errors?: unknown }, status: number): ComfyRejectedError {
  const nodeErrors = parseNodeErrors(data.node_errors);
  const error = data.error as { message?: string; details?: string } | string | undefined;
  const base = typeof error === "string" ? error : error ? describe(error) : `HTTP ${status}`;
  const first = nodeErrors[0];
  const tail = first ? ` — ${first.classType || first.node}: ${first.message}` : "";
  return new ComfyRejectedError(`ComfyUI отклонил граф: ${base}${tail}`, nodeErrors);
}

/** Ошибка выполнения из истории (status_str = error) или null. */
export function historyError(history: ComfyHistory): ComfyRejectedError | null {
  if (history.status?.status_str !== "error") return null;
  const failure = (history.status.messages || []).find(([kind]) => kind === "execution_error")?.[1] as
    | { node_id?: unknown; node_type?: unknown; exception_message?: unknown }
    | undefined;
  if (!failure) return new ComfyRejectedError("ComfyUI: прогон завершился с ошибкой");
  const node = String(failure.node_id ?? "?");
  const classType = typeof failure.node_type === "string" ? failure.node_type : undefined;
  const message = String(failure.exception_message ?? "ошибка").trim();
  return new ComfyRejectedError(`ComfyUI: ошибка в ${classType || node}: ${message.split("\n")[0]}`, [
    { node, classType, message },
  ]);
}

function comfyBase(): string {
  return (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  return text.trim() || `${res.status}`;
}

export async function uploadComfyImage(bytes: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(bytes)]), filename);
  form.append("overwrite", "true");
  const res = await fetch(`${comfyBase()}/upload/image`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload/image ${await readError(res)}`);
  const data = (await res.json()) as { name?: string };
  return data.name || filename;
}

export async function submitComfyPrompt(
  prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
): Promise<string> {
  const res = await fetch(`${comfyBase()}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  let data: { prompt_id?: string; error?: unknown; node_errors?: Record<string, unknown> };
  try {
    data = await res.json();
  } catch {
    throw new ComfyRejectedError(`ComfyUI отклонил граф: HTTP ${res.status}`);
  }
  if (!res.ok || Object.keys(data.node_errors || {}).length > 0) throw rejection(data, res.status);
  if (!data.prompt_id) throw new Error("prompt_id пустой");
  return data.prompt_id;
}

export async function readComfyHistory(promptId: string): Promise<ComfyHistory | null> {
  const res = await fetch(`${comfyBase()}/history/${promptId}`);
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, ComfyHistory>;
  return data[promptId] ?? null;
}

/** Очередь ComfyUI: id выполняемых и ждущих (по порядку) prompt. */
export async function readComfyQueue(): Promise<{ running: string[]; pending: string[] }> {
  const res = await fetch(`${comfyBase()}/queue`);
  if (!res.ok) throw new Error(`queue ${await readError(res)}`);
  const data = (await res.json()) as { queue_running?: unknown[][]; queue_pending?: unknown[][] };
  const ids = (items: unknown[][] | undefined) =>
    [...(items || [])]
      .filter((item) => Array.isArray(item) && typeof item[1] === "string")
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map((item) => item[1] as string);
  return { running: ids(data.queue_running), pending: ids(data.queue_pending) };
}

/** Место prompt в очереди: 0 — выполняется, 1.. — ждёт, null — в очереди нет. */
export function queuePositionOf(queue: { running: string[]; pending: string[] }, promptId: string): number | null {
  if (queue.running.includes(promptId)) return 0;
  const index = queue.pending.indexOf(promptId);
  return index === -1 ? null : index + 1;
}

/**
 * Снимает prompt из очереди ComfyUI. Если он уже выполняется — прерывает именно его.
 * Ошибки сети игнорирует: отмена на доске важнее, чем ответ ComfyUI.
 */
export async function cancelComfyPrompt(promptId: string): Promise<void> {
  try {
    const res = await fetch(`${comfyBase()}/queue`);
    if (res.ok) {
      const data = (await res.json()) as { queue_running?: unknown[][] };
      const running = (data.queue_running || []).some((item) => item?.[1] === promptId);
      if (running) {
        await fetch(`${comfyBase()}/interrupt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt_id: promptId }),
        });
      }
    }
    await fetch(`${comfyBase()}/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete: [promptId] }),
    });
  } catch {
    // ComfyUI недоступен: задание на доске всё равно помечается отменённым.
  }
}

export function listHistoryImages(history: ComfyHistory): ComfyImageRef[] {
  const files: ComfyImageRef[] = [];
  for (const output of Object.values(history.outputs || {})) {
    for (const group of [output.images, output.gifs, output.videos]) {
      for (const file of group || []) files.push(file);
    }
  }
  return files;
}

export async function downloadComfyImage(image: ComfyImageRef): Promise<Buffer> {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder || "",
    type: image.type || "output",
  });
  const res = await fetch(`${comfyBase()}/view?${query}`);
  if (!res.ok) throw new Error(`view ${image.filename} ${await readError(res)}`);
  return Buffer.from(await res.arrayBuffer());
}
