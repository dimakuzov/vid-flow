import { Comfy, ComfyError, InsufficientCredits, InvalidWorkflow, QueueFull, Unauthorized } from "@comfyorg/sdk";
import type { ApiPrompt } from "../contracts/comfy-job";
import * as legacyLocal from "./client";
import { ComfyRejectedError, parseNodeErrors, type ComfyHistory, type ComfyImageRef } from "./client";
import { cloudKey, type CloudJob } from "./cloud";

/*
 * Второй транспорт: официальный @comfyorg/sdk (Comfy API v2). Те же функции и формы результата,
 * что в client.ts (локальный ComfyUI) и cloud.ts (Comfy Cloud), поэтому queue.ts меняет только модуль.
 * Включается COMFY_TRANSPORT=sdk. Локально SDK говорит с comfy-api-proxy (COMFY_BASE_URL),
 * а не с самим ComfyUI на :8188.
 */

export const DEFAULT_PROXY_URL = "http://127.0.0.1:8189";

/** Что нужно от SDK-клиента. Тесты подставляют заглушку, живой ComfyUI не нужен. */
export interface SdkOutputLike {
  nodeId: string;
  name: string;
  type: string;
  toBytes(): Promise<Uint8Array>;
}

export interface SdkJobLike {
  id: string;
  status: string;
  error?: { message?: string; node_id?: string | null; class_type?: string | null } | null;
  outputs: SdkOutputLike[];
  cancel(): Promise<unknown>;
}

export interface SdkAssetLike {
  commit(): Promise<unknown>;
}

export interface SdkClientLike {
  assets: { fromBytes(data: Uint8Array, options?: { filename?: string }): SdkAssetLike };
  workflows: { fromJson(graph: Record<string, unknown>): { json: Record<string, unknown>; setInput(node: string, field: string, value: unknown): void } };
  jobs: { get(id: string): Promise<SdkJobLike> };
  submit(workflow: unknown, options?: { apiKey?: string }): Promise<SdkJobLike>;
}

/** SDK читает COMFY_BASE_URL и COMFY_API_KEY при создании клиента: на время вызова подменяем. */
function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(patch)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

let localClient: Comfy | null = null;
const cloudClients = new Map<string, Comfy>();

function localSdk(): Comfy {
  localClient ??= withEnv(
    { COMFY_BASE_URL: (process.env.COMFY_BASE_URL?.trim() || DEFAULT_PROXY_URL).replace(/\/$/, ""), COMFY_API_KEY: undefined },
    () => new Comfy(),
  );
  return localClient;
}

function cloudSdk(): Comfy {
  const key = cloudKey();
  let client = cloudClients.get(key);
  if (!client) {
    // Пустой COMFY_BASE_URL — это Comfy Cloud у SDK. COMFY_CLOUD_URL, если задан, ведёт на другой стенд.
    client = withEnv({ COMFY_BASE_URL: process.env.COMFY_CLOUD_URL?.trim() || undefined }, () => new Comfy({ apiKey: key }));
    cloudClients.set(key, client);
  }
  return client;
}

/** Ошибка SDK → ComfyRejectedError (ноды) или Error с понятным текстом. Другие ошибки (сеть) идут как есть. */
export function translateSdkError(error: unknown, label: string): unknown {
  if (error instanceof InvalidWorkflow) {
    const details = (error.details || {}) as { node_errors?: unknown };
    const nodeErrors = parseNodeErrors(details.node_errors);
    const first = nodeErrors[0];
    return new ComfyRejectedError(
      `${label} отклонил граф: ${error.message}${first ? ` — ${first.classType || first.node}: ${first.message}` : ""}`,
      nodeErrors,
    );
  }
  if (error instanceof Unauthorized) return new Error(`${label}: ключ не принят (401)`);
  if (error instanceof InsufficientCredits) return new Error(`${label}: не хватает кредитов (402)`);
  if (error instanceof QueueFull) return new Error(`${label}: очередь переполнена (429)`);
  if (error instanceof ComfyError) return new Error(`${label}: ${error.message}`);
  return error;
}

/** Строковые входы графа, равные имени загруженного файла, заменяются дескрипторами SDK. */
export function bindUploads(
  prompt: ApiPrompt,
  assets: Map<string, unknown>,
  set: (node: string, field: string, value: unknown) => void,
): void {
  for (const [node, spec] of Object.entries(prompt)) {
    for (const [field, value] of Object.entries(spec.inputs)) {
      if (typeof value === "string" && assets.has(value)) set(node, field, assets.get(value));
    }
  }
}

function groupFor(type: string): "images" | "videos" | "text" | null {
  if (type === "image") return "images";
  if (type === "video") return "videos";
  if (type === "text") return "text";
  // audio / file / latent: доска таких выходов не забирает.
  return null;
}

/**
 * Задание SDK → форма истории ComfyUI. null — ещё не закончено.
 * Имя файла — имя выхода, subfolder — id задания: по ним downloadFile находит выход заново.
 */
export async function historyFromJob(job: SdkJobLike): Promise<ComfyHistory | null> {
  if (job.status === "queued" || job.status === "running" || job.status === "canceling") return null;
  if (job.status !== "succeeded") {
    const failure = job.error;
    const message =
      failure?.message || (job.status === "canceled" ? "задание отменено" : `задание завершилось: ${job.status}`);
    return {
      status: {
        status_str: "error",
        completed: false,
        messages: [
          ["execution_error", { node_id: failure?.node_id ?? undefined, node_type: failure?.class_type ?? undefined, exception_message: message }],
        ],
      },
    };
  }
  const outputs: NonNullable<ComfyHistory["outputs"]> = {};
  for (const output of job.outputs) {
    const group = groupFor(output.type);
    if (!group) continue;
    const entry = (outputs[output.nodeId] ??= {});
    if (group === "text") {
      const text = Buffer.from(await output.toBytes()).toString("utf8");
      entry.text = [...(Array.isArray(entry.text) ? entry.text : entry.text ? [entry.text] : []), text];
    } else {
      (entry[group] ??= []).push({ filename: output.name, subfolder: job.id, type: "output" });
    }
  }
  return { outputs, status: { status_str: "success", completed: true } };
}

function cloudStatusOf(status: string): CloudJob["status"] {
  if (status === "queued") return "pending";
  if (status === "running" || status === "canceling") return "in_progress";
  if (status === "succeeded") return "completed";
  if (status === "canceled") return "cancelled";
  return "failed";
}

/** Операции одного SDK-клиента. `label` — как называть сервис в сообщениях об ошибках. */
export function createOps(getClient: () => SdkClientLike, label: string, apiKey?: () => string) {
  const uploads = new Map<string, unknown>();

  async function upload(bytes: Buffer, filename: string): Promise<string> {
    try {
      const asset = getClient().assets.fromBytes(new Uint8Array(bytes), { filename });
      await asset.commit();
      uploads.set(filename, asset);
      return filename;
    } catch (error) {
      throw translateSdkError(error, label);
    }
  }

  async function submit(prompt: ApiPrompt): Promise<string> {
    const client = getClient();
    try {
      const workflow = client.workflows.fromJson(structuredClone(prompt) as Record<string, unknown>);
      bindUploads(prompt, uploads, (node, field, value) => workflow.setInput(node, field, value));
      uploads.clear();
      const job = await client.submit(workflow, apiKey ? { apiKey: apiKey() } : undefined);
      return job.id;
    } catch (error) {
      throw translateSdkError(error, label);
    }
  }

  async function readJob(promptId: string): Promise<SdkJobLike> {
    try {
      return await getClient().jobs.get(promptId);
    } catch (error) {
      throw translateSdkError(error, label);
    }
  }

  async function download(file: ComfyImageRef): Promise<Buffer> {
    const job = await readJob(file.subfolder || "");
    const output = job.outputs.find((item) => item.name === file.filename);
    if (!output) throw new Error(`${label}: нет файла ${file.filename}`);
    return Buffer.from(await output.toBytes());
  }

  async function cancel(promptId: string): Promise<void> {
    try {
      await (await getClient().jobs.get(promptId)).cancel();
    } catch {
      // Сервис недоступен: задание на доске всё равно помечается отменённым.
    }
  }

  return { upload, submit, readJob, download, cancel };
}

const local = createOps(localSdk, "ComfyUI");
const cloud = createOps(cloudSdk, "Comfy Cloud", cloudKey);

// ---- Локальный ComfyUI (через comfy-api-proxy): формы client.ts ----

export const uploadComfyImage = local.upload;
export const submitComfyPrompt = local.submit;
export const downloadComfyImage = local.download;
export const cancelComfyPrompt = local.cancel;

/**
 * Текстовые выходы нод (PreviewAny: слова Whisper) SDK не отдаёт: у задания `outputs` пуст.
 * Берём их из истории самого ComfyUI: id задания в SDK равен его prompt_id. Файлы остаются за SDK.
 */
export function mergeTexts(history: ComfyHistory, source: ComfyHistory | null): ComfyHistory {
  if (!source?.outputs) return history;
  const outputs = { ...history.outputs };
  for (const [node, output] of Object.entries(source.outputs)) {
    if (output.text === undefined) continue;
    outputs[node] = { ...outputs[node], text: output.text };
  }
  return { ...history, outputs };
}

export async function readComfyHistory(promptId: string): Promise<ComfyHistory | null> {
  const history = await historyFromJob(await local.readJob(promptId));
  if (!history || history.status?.status_str !== "success") return history;
  let source: ComfyHistory | null = null;
  try {
    source = await legacyLocal.readComfyHistory(promptId);
  } catch {
    // ComfyUI напрямую недоступен: остаются только файлы SDK.
  }
  return mergeTexts(history, source);
}

/**
 * SDK не описывает чтение общей очереди: списка ждущих и выполняемых заданий в нём нет.
 * Бросаем, а queue.ts в этом случае не меняет queuePosition и таймаут «потерянного» задания не считает.
 */
export async function readComfyQueue(): Promise<{ running: string[]; pending: string[] }> {
  throw new Error("SDK не отдаёт очередь ComfyUI");
}

// ---- Comfy Cloud: формы cloud.ts ----

export const uploadCloudImage = cloud.upload;
export const submitCloudPrompt = cloud.submit;
export const downloadCloudFile = cloud.download;
export const cancelCloudJob = cloud.cancel;

export async function readCloudJob(promptId: string): Promise<CloudJob> {
  const job = await cloud.readJob(promptId);
  const status = cloudStatusOf(job.status);
  if (status === "failed") {
    const failure = job.error;
    return { status, error: `Comfy Cloud: ошибка в ${failure?.class_type || "ноде"}: ${String(failure?.message || job.status).split("\n")[0]}` };
  }
  if (status !== "completed") return { status };
  return { status, outputs: (await historyFromJob(job))?.outputs };
}
