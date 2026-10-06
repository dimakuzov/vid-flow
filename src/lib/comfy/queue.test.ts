// Очередь с подменённым fetch: ComfyUI не нужен.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-queue-"));
process.env.DATA_ROOT = tmp;
process.env.COMFY_URL = "http://comfy.test";
// Фоновые циклы в тесте не запускаем: задания остаются файлами.
process.env.FRAMEBOARD_LOOPS = "off";

import { cancelComfyJob, drainComfyQueue, enqueueComfyJob, readComfyJob } from "./queue";

const realFetch = globalThis.fetch;
const calls: { url: string; body?: string }[] = [];

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}

function mockComfy(hooks: { onUpload?: () => Promise<void> | void; onPrompt?: () => Promise<void> | void }) {
  calls.length = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.endsWith("/upload/image")) {
      await hooks.onUpload?.();
      return json({ name: "view.png" });
    }
    if (url.endsWith("/prompt")) {
      await hooks.onPrompt?.();
      return json({ prompt_id: "p-1", node_errors: {} });
    }
    if (url.endsWith("/queue") && init?.method !== "POST") return json({ queue_running: [] });
    return json({});
  }) as typeof fetch;
}

function newJob(id: string) {
  const image = path.join(tmp, "view.png");
  fs.writeFileSync(image, "png");
  return enqueueComfyJob({
    id,
    status: "pending",
    prompt: { "1": { class_type: "LoadImage", inputs: { image: "view.png" } } },
    uploads: [{ path: image, filename: "view.png" }],
    saveTo: path.join(tmp, "out"),
  });
}

after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("отмена во время загрузки картинок: prompt в ComfyUI не уходит", async () => {
  newJob("j-upload");
  mockComfy({ onUpload: () => cancelComfyJob("j-upload") });
  await drainComfyQueue();
  assert.equal(readComfyJob("j-upload")?.status, "cancelled");
  assert.ok(!calls.some((call) => call.url.endsWith("/prompt")));
});

test("отмена во время отправки prompt: задание остаётся отменённым, prompt снят из ComfyUI", async () => {
  newJob("j-prompt");
  mockComfy({ onPrompt: () => cancelComfyJob("j-prompt") });
  await drainComfyQueue();
  const job = readComfyJob("j-prompt");
  assert.equal(job?.status, "cancelled");
  assert.equal(job?.promptId, undefined);
  assert.ok(calls.some((call) => call.url.endsWith("/queue") && call.body?.includes('"p-1"')));
});

test("ComfyUI недоступен: задание остаётся pending", async () => {
  newJob("j-offline");
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
  }) as typeof fetch;
  await drainComfyQueue();
  assert.equal(readComfyJob("j-offline")?.status, "pending");
});
