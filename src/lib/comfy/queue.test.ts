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

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function routeComfy(handler: Handler) {
  calls.length = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    return handler(url, init);
  }) as typeof fetch;
}

test("node_errors → status error, короткий error и читаемый nodeErrors", async () => {
  newJob("j-nodes");
  routeComfy((url) => {
    if (url.endsWith("/prompt")) {
      return new Response(
        JSON.stringify({
          error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation", details: "" },
          node_errors: {
            "470": {
              class_type: "LoadImage",
              errors: [{ type: "custom_validation_failed", message: "Custom validation failed for node", details: "image - Invalid image file: cafe.png" }],
            },
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    return json({ name: "view.png" });
  });
  await drainComfyQueue();
  const job = readComfyJob("j-nodes")!;
  assert.equal(job.status, "error");
  assert.ok(job.finishedAt);
  assert.match(job.error!, /^ComfyUI отклонил граф: Prompt outputs failed validation — LoadImage: Custom validation failed/);
  assert.ok(!job.error!.includes("{"), "не JSON");
  assert.deepEqual(job.nodeErrors, [
    { node: "470", classType: "LoadImage", message: "Custom validation failed for node: image - Invalid image file: cafe.png" },
  ]);
});

test("queuePosition по GET /queue, submittedAt, затем файлы с уникальными именами и finishedAt", async () => {
  const job = newJob("j-files");
  const saveDir = job.saveTo;
  fs.mkdirSync(saveDir, { recursive: true });
  fs.writeFileSync(path.join(saveDir, "s01_00001_.png"), "old");
  fs.writeFileSync(path.join(saveDir, "s01_00001_-2.png"), "old2");
  let queue: { queue_running: unknown[][]; queue_pending: unknown[][] } = {
    queue_running: [[5, "other", {}, {}, []]],
    queue_pending: [[9, "later", {}, {}, []], [7, "p-files", {}, {}, []]],
  };
  let history: unknown = {};
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]);
  routeComfy((url, init) => {
    if (url.endsWith("/upload/image")) return json({ name: "view.png" });
    if (url.endsWith("/prompt")) return json({ prompt_id: "p-files", node_errors: {} });
    if (url.endsWith("/queue") && init?.method !== "POST") return json(queue);
    if (url.includes("/history/")) return json(history);
    if (url.includes("/view?")) return new Response(pngBytes);
    return json({});
  });

  await drainComfyQueue();
  let current = readComfyJob("j-files")!;
  assert.equal(current.status, "running");
  assert.equal(current.promptId, "p-files");
  assert.ok(current.submittedAt);
  assert.equal(current.queuePosition, 1, "первый в ожидании (по номеру)");

  queue = { queue_running: [[7, "p-files", {}, {}, []]], queue_pending: [] };
  calls.length = 0;
  await drainComfyQueue();
  assert.equal(readComfyJob("j-files")!.queuePosition, 0);
  assert.equal(calls.filter((call) => call.url.endsWith("/queue")).length, 1, "один GET /queue на проход");

  history = {
    "p-files": {
      status: { status_str: "success", completed: true },
      outputs: {
        "9": {
          images: [
            { filename: "s01_00001_.png", subfolder: "frameboard/location", type: "output" },
            { filename: "s01_00002_.png", subfolder: "frameboard/location", type: "output" },
          ],
        },
      },
    },
  };
  await drainComfyQueue();
  current = readComfyJob("j-files")!;
  assert.equal(current.status, "done");
  assert.deepEqual(current.files, ["s01_00001_-3.png", "s01_00002_.png"]);
  assert.equal(current.queuePosition, null);
  assert.ok(current.finishedAt);
  assert.equal(fs.readFileSync(path.join(saveDir, "s01_00001_.png"), "utf8"), "old", "старый файл не затёрт");
  assert.deepEqual(fs.readFileSync(path.join(saveDir, "s01_00001_-3.png")), pngBytes, "байты как есть");
});

test("ошибка выполнения в истории → error с нодой", async () => {
  newJob("j-exec");
  routeComfy((url, init) => {
    if (url.endsWith("/upload/image")) return json({ name: "view.png" });
    if (url.endsWith("/prompt")) return json({ prompt_id: "p-exec", node_errors: {} });
    if (url.endsWith("/queue") && init?.method !== "POST") return json({ queue_running: [], queue_pending: [] });
    if (url.includes("/history/")) {
      return json({
        "p-exec": {
          status: {
            status_str: "error",
            messages: [
              ["execution_start", {}],
              ["execution_error", { node_id: "129:86", node_type: "KSamplerAdvanced", exception_message: "CUDA out of memory\nTried to allocate" }],
            ],
          },
          outputs: {},
        },
      });
    }
    return json({});
  });
  await drainComfyQueue();
  const job = readComfyJob("j-exec")!;
  assert.equal(job.status, "error");
  assert.equal(job.error, "ComfyUI: ошибка в KSamplerAdvanced: CUDA out of memory");
  assert.equal(job.nodeErrors?.[0].node, "129:86");
});

test("ComfyUI недоступен на этапе отправки: submittedAt не появляется, позиция неизвестна", async () => {
  newJob("j-offline-2");
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
  }) as typeof fetch;
  await drainComfyQueue();
  const job = readComfyJob("j-offline-2")!;
  assert.equal(job.status, "pending");
  assert.equal(job.submittedAt, undefined);
  assert.equal(job.queuePosition, null);
  assert.ok(job.queuedAt);
});
