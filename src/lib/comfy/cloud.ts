import type { ApiPrompt } from "../contracts/comfy-job";
import { ComfyRejectedError, parseNodeErrors, type ComfyHistory, type ComfyImageRef } from "./client";

/*
 * Comfy Cloud (cloud.comfy.org), API v1: https://docs.comfy.org/development/cloud/api-reference
 * Ключ — COMFY_CLOUD_API_KEY (в .env.local, в git не попадает). Платно: каждый POST /api/prompt
 * списывает кредиты, поэтому повторных отправок здесь нет — их решает пользователь.
 */

export function cloudBase(): string {
  return (process.env.COMFY_CLOUD_URL || "https://cloud.comfy.org").replace(/\/$/, "");
}

export function cloudKey(): string {
  const key = process.env.COMFY_CLOUD_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "Нет ключа Comfy Cloud: впишите COMFY_CLOUD_API_KEY=… в .env.local в корне проекта и перезапустите доску.",
    );
  }
  return key;
}

async function readText(res: Response): Promise<string> {
  try {
    return (await res.text()).trim().slice(0, 300);
  } catch {
    return "";
  }
}

/** Понятный текст по коду ответа облака. */
function cloudStatusText(status: number): string {
  if (status === 401) return "ключ Comfy Cloud не принят (401)";
  if (status === 402) return "не хватает кредитов Comfy Cloud (402)";
  if (status === 429) return "подписка Comfy Cloud неактивна или очередь переполнена (429)";
  return `HTTP ${status}`;
}

/** Картинка в облако. Ответ — имя, которое надо подставить в LoadImage. */
export async function uploadCloudImage(bytes: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(bytes)]), filename);
  form.append("type", "input");
  form.append("overwrite", "true");
  const res = await fetch(`${cloudBase()}/api/upload/image`, {
    method: "POST",
    headers: { "X-API-Key": cloudKey() },
    body: form,
  });
  if (!res.ok) throw new Error(`Comfy Cloud, загрузка ${filename}: ${cloudStatusText(res.status)} ${await readText(res)}`);
  const data = (await res.json()) as { name?: string };
  if (!data.name) throw new Error(`Comfy Cloud, загрузка ${filename}: в ответе нет имени файла`);
  return data.name;
}

/** Отправка графа. Ключ уходит и в extra_data: платные ноды (HeyGen) списывают по нему кредиты. */
export async function submitCloudPrompt(prompt: ApiPrompt): Promise<string> {
  const key = cloudKey();
  const res = await fetch(`${cloudBase()}/api/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": key },
    body: JSON.stringify({ prompt, extra_data: { api_key_comfy_org: key } }),
  });
  let data: { prompt_id?: string; error?: unknown; node_errors?: unknown } = {};
  try {
    data = await res.json();
  } catch {
    // Тело не JSON: ниже ошибка по коду ответа.
  }
  const nodeErrors = parseNodeErrors(data.node_errors);
  if (!res.ok || nodeErrors.length) {
    const error = data.error as { message?: string } | string | undefined;
    const text = typeof error === "string" ? error : error?.message || cloudStatusText(res.status);
    const first = nodeErrors[0];
    throw new ComfyRejectedError(
      `Comfy Cloud отклонил граф: ${text}${first ? ` — ${first.classType || first.node}: ${first.message}` : ""}`,
      nodeErrors,
    );
  }
  if (!data.prompt_id) throw new Error("Comfy Cloud: в ответе нет prompt_id");
  return data.prompt_id;
}

export interface CloudJob {
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  outputs?: ComfyHistory["outputs"];
  error?: string;
}

/** Состояние задания: GET /api/jobs/{id}. Выходы есть только у завершённых. */
export async function readCloudJob(promptId: string): Promise<CloudJob> {
  const res = await fetch(`${cloudBase()}/api/jobs/${encodeURIComponent(promptId)}`, {
    headers: { "X-API-Key": cloudKey() },
  });
  if (!res.ok) throw new Error(`Comfy Cloud, задание ${promptId}: ${cloudStatusText(res.status)}`);
  const data = (await res.json()) as {
    status: CloudJob["status"];
    outputs?: ComfyHistory["outputs"];
    execution_error?: { node_type?: string; exception_message?: string };
  };
  const failure = data.execution_error;
  return {
    status: data.status,
    outputs: data.outputs,
    error: failure
      ? `Comfy Cloud: ошибка в ${failure.node_type || "ноде"}: ${String(failure.exception_message || "").split("\n")[0]}`
      : undefined,
  };
}

/**
 * Файл результата. /api/view отвечает 302 на подписанную ссылку; по ней идём без ключа,
 * чтобы не отдать его хранилищу (так велит документация).
 */
export async function downloadCloudFile(file: ComfyImageRef): Promise<Buffer> {
  const query = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder || "",
    type: file.type || "output",
  });
  const res = await fetch(`${cloudBase()}/api/view?${query}`, {
    headers: { "X-API-Key": cloudKey() },
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location) throw new Error(`Comfy Cloud, ${file.filename}: переадресация без адреса`);
    const signed = await fetch(location);
    if (!signed.ok) throw new Error(`Comfy Cloud, ${file.filename}: HTTP ${signed.status}`);
    return Buffer.from(await signed.arrayBuffer());
  }
  if (!res.ok) throw new Error(`Comfy Cloud, ${file.filename}: ${cloudStatusText(res.status)}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Снять задание: из очереди и, если уже идёт, прервать. Ошибки сети не мешают отмене на доске. */
export async function cancelCloudJob(promptId: string): Promise<void> {
  const headers = { "Content-Type": "application/json", "X-API-Key": cloudKey() };
  try {
    // interrupt прерывает текущее выполнение пользователя: только если идёт именно это задание.
    const running = (await readCloudJob(promptId)).status === "in_progress";
    await fetch(`${cloudBase()}/api/queue`, { method: "POST", headers, body: JSON.stringify({ delete: [promptId] }) });
    if (running) {
      await fetch(`${cloudBase()}/api/interrupt`, { method: "POST", headers, body: JSON.stringify({ prompt_id: promptId }) });
    }
  } catch {
    // Облако недоступно: задание на доске всё равно отменено.
  }
}

/** Имена загруженных файлов → имена в облаке: подставить во все строковые входы графа. */
export function renameUploads(prompt: ApiPrompt, names: Map<string, string>): ApiPrompt {
  const next = structuredClone(prompt);
  for (const node of Object.values(next)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (typeof value === "string" && names.has(value)) node.inputs[key] = names.get(value)!;
    }
  }
  return next;
}
