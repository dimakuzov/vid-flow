import assert from "node:assert/strict";
import test from "node:test";
import { InvalidWorkflow } from "@comfyorg/sdk";
import { ComfyRejectedError, historyError, listHistoryImages, listHistoryTexts } from "./client";
import { bindUploads, createOps, historyFromJob, mergeTexts, translateSdkError, type SdkClientLike, type SdkJobLike } from "./sdk";
import { transport, transportName } from "./transport";
import * as legacyLocal from "./client";
import * as legacyCloud from "./cloud";
import * as sdk from "./sdk";

const bytes = (text: string) => async () => new TextEncoder().encode(text);

function job(patch: Partial<SdkJobLike>): SdkJobLike {
  return { id: "job-1", status: "succeeded", outputs: [], cancel: async () => undefined, ...patch };
}

test("COMFY_TRANSPORT выбирает реализацию, по умолчанию sdk", () => {
  assert.equal(transportName({}), "sdk");
  assert.equal(transportName({ COMFY_TRANSPORT: "legacy" }), "legacy");
  assert.equal(transportName({ COMFY_TRANSPORT: " LEGACY " }), "legacy");
  assert.equal(transportName({ COMFY_TRANSPORT: "bogus" }), "sdk");
  assert.equal(transportName({ COMFY_TRANSPORT: " SDK " }), "sdk");
  assert.equal(transport({}).submitComfyPrompt, sdk.submitComfyPrompt);
  assert.equal(transport({}).submitCloudPrompt, sdk.submitCloudPrompt);
  assert.equal(transport({ COMFY_TRANSPORT: "legacy" }).submitComfyPrompt, legacyLocal.submitComfyPrompt);
  assert.equal(transport({ COMFY_TRANSPORT: "legacy" }).submitCloudPrompt, legacyCloud.submitCloudPrompt);
  assert.equal(transport({ COMFY_TRANSPORT: "sdk" }).submitComfyPrompt, sdk.submitComfyPrompt);
  assert.equal(transport({ COMFY_TRANSPORT: "sdk" }).readCloudJob, sdk.readCloudJob);
});

test("незавершённое задание SDK — null, как отсутствие истории", async () => {
  for (const status of ["queued", "running", "canceling"]) assert.equal(await historyFromJob(job({ status })), null);
});

test("успех: выходы сгруппированы по ноде и читаются listHistoryImages/Texts", async () => {
  const history = await historyFromJob(
    job({
      outputs: [
        { nodeId: "9", name: "a.png", type: "image", toBytes: bytes("") },
        { nodeId: "12", name: "v.mp4", type: "video", toBytes: bytes("") },
        { nodeId: "20", name: "t.txt", type: "text", toBytes: bytes("привет") },
        { nodeId: "21", name: "a.wav", type: "audio", toBytes: bytes("") },
      ],
    }),
  );
  assert.ok(history);
  assert.equal(historyError(history), null);
  assert.deepEqual(
    listHistoryImages(history).map((file) => [file.filename, file.subfolder]),
    [["a.png", "job-1"], ["v.mp4", "job-1"]],
  );
  assert.deepEqual(listHistoryTexts(history), [{ node: "20", text: "привет" }]);
});

test("сбой выполнения превращается в ComfyRejectedError с нодой", async () => {
  const history = await historyFromJob(
    job({ status: "failed", error: { message: "OOM\nstack", node_id: "7", class_type: "KSampler" } }),
  );
  const error = historyError(history!);
  assert.ok(error instanceof ComfyRejectedError);
  assert.match(error.message, /KSampler: OOM/);
  assert.equal(error.nodeErrors[0].node, "7");
});

test("отменённое задание — тоже ошибка истории, не пустой успех", async () => {
  const history = await historyFromJob(job({ status: "canceled" }));
  assert.ok(historyError(history!));
});

test("bindUploads подставляет дескрипторы только в входы с именем загруженного файла", () => {
  const prompt = {
    "1": { class_type: "LoadImage", inputs: { image: "face.png" } },
    "2": { class_type: "Other", inputs: { text: "face.png.txt", n: 3 } },
  };
  const calls: unknown[][] = [];
  bindUploads(prompt, new Map([["face.png", "H"]]), (...args) => calls.push(args));
  assert.deepEqual(calls, [["1", "image", "H"]]);
});

test("InvalidWorkflow с node_errors даёт ComfyRejectedError с нодами", () => {
  const error = new InvalidWorkflow("bad graph", {
    details: { node_errors: { "5": { class_type: "LoadImage", errors: [{ message: "нет файла", details: "x.png" }] } } },
  });
  const out = translateSdkError(error, "ComfyUI");
  assert.ok(out instanceof ComfyRejectedError);
  assert.equal(out.nodeErrors[0].node, "5");
  assert.match(out.message, /LoadImage: нет файла: x\.png/);
});

test("сетевая ошибка проходит как есть, чтобы очередь признала ComfyUI офлайн", () => {
  const error = new TypeError("fetch failed");
  assert.equal(translateSdkError(error, "ComfyUI"), error);
});

test("submit: загрузка → привязка к графу → id задания; исходный prompt не меняется", async () => {
  const set: unknown[][] = [];
  let submittedKey: string | undefined = "unset";
  const asset = { committed: false, async commit() { this.committed = true; } };
  const client: SdkClientLike = {
    assets: { fromBytes: () => asset },
    workflows: { fromJson: (json) => ({ json, setInput: (...args: unknown[]) => void set.push(args) }) as never },
    jobs: { get: async () => job({}) },
    submit: async (_wf, options) => {
      submittedKey = options?.apiKey;
      return job({ id: "p-42" });
    },
  };
  const ops = createOps(() => client, "Comfy Cloud", () => "k");
  const prompt = { "1": { class_type: "LoadImage", inputs: { image: "face.png" } } };
  assert.equal(await ops.upload(Buffer.from("x"), "face.png"), "face.png");
  assert.equal(asset.committed, true);
  assert.equal(await ops.submit(prompt), "p-42");
  assert.deepEqual(set, [["1", "image", asset]]);
  assert.equal(submittedKey, "k");
  assert.deepEqual(prompt["1"].inputs, { image: "face.png" });
});

test("download находит выход по имени и id задания, cancel глотает сбой", async () => {
  const client = {
    jobs: {
      get: async (id: string) =>
        job({ id, outputs: [{ nodeId: "9", name: "a.png", type: "image", toBytes: bytes("PNG") }] }),
    },
  } as unknown as SdkClientLike;
  const ops = createOps(() => client, "ComfyUI");
  assert.equal((await ops.download({ filename: "a.png", subfolder: "job-1" })).toString(), "PNG");
  await assert.rejects(ops.download({ filename: "nope.png", subfolder: "job-1" }), /нет файла/);
  const broken = { jobs: { get: async () => { throw new Error("down"); } } } as unknown as SdkClientLike;
  await createOps(() => broken, "ComfyUI").cancel("job-1");
});

test("readComfyQueue в SDK-режиме явно не поддержан", async () => {
  await assert.rejects(sdk.readComfyQueue(), /не отдаёт очередь/);
});

test("выбор в интерфейсе хранится в data/ и важнее COMFY_TRANSPORT; без него работает переменная", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { readTransportSetting, writeTransportSetting } = await import("./transport");
  const saved = { root: process.env.DATA_ROOT, mode: process.env.COMFY_TRANSPORT };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fb-transport-"));
  process.env.DATA_ROOT = root;
  try {
    delete process.env.COMFY_TRANSPORT;
    assert.equal(readTransportSetting(), null);
    assert.equal(transportName(), "sdk");
    process.env.COMFY_TRANSPORT = "sdk";
    assert.equal(transportName(), "sdk");
    writeTransportSetting("legacy");
    assert.equal(transportName(), "legacy");
    writeTransportSetting("sdk");
    delete process.env.COMFY_TRANSPORT;
    assert.equal(transportName(), "sdk");
    assert.equal(transport().submitComfyPrompt, sdk.submitComfyPrompt);
    fs.writeFileSync(path.join(root, "comfy_transport.txt"), "мусор\n");
    assert.equal(readTransportSetting(), null);
  } finally {
    if (saved.root === undefined) delete process.env.DATA_ROOT;
    else process.env.DATA_ROOT = saved.root;
    if (saved.mode === undefined) delete process.env.COMFY_TRANSPORT;
    else process.env.COMFY_TRANSPORT = saved.mode;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("переключение блокируется, пока есть задание в статусе running (API отвечает 409)", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { GET, POST } = await import("../../app/api/comfy/transport/route");
  const saved = process.env.DATA_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fb-transport-"));
  process.env.DATA_ROOT = root;
  const post = (transport: string) =>
    POST(new Request("http://x/api/comfy/transport", { method: "POST", body: JSON.stringify({ transport }) }));
  try {
    assert.deepEqual(await (await GET()).json(), { transport: "sdk", locked: false });
    assert.equal((await post("legacy")).status, 200);
    assert.deepEqual(await (await GET()).json(), { transport: "legacy", locked: false });
    assert.equal((await post("sdk")).status, 200);
    assert.deepEqual(await (await GET()).json(), { transport: "sdk", locked: false });
    assert.equal((await post("bogus")).status, 400);
    const queue = path.join(root, "comfy_queue");
    fs.mkdirSync(queue, { recursive: true });
    fs.writeFileSync(
      path.join(queue, "busy.json"),
      JSON.stringify({ id: "busy", status: "running", promptId: "p1", prompt: {}, saveTo: root }),
    );
    assert.deepEqual(await (await GET()).json(), { transport: "sdk", locked: true });
    const blocked = await post("legacy");
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).transport, "sdk");
    fs.writeFileSync(
      path.join(queue, "busy.json"),
      JSON.stringify({ id: "busy", status: "done", prompt: {}, saveTo: root }),
    );
    assert.equal((await post("legacy")).status, 200);
  } finally {
    if (saved === undefined) delete process.env.DATA_ROOT;
    else process.env.DATA_ROOT = saved;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("mergeTexts добавляет текст PreviewAny из истории ComfyUI и не трогает файлы SDK", () => {
  const history = {
    outputs: { "9": { images: [{ filename: "a.png", subfolder: "job-1", type: "output" }] } },
    status: { status_str: "success", completed: true },
  };
  const source = { outputs: { "93": { text: ["[]"] }, "9": { images: [{ filename: "other.png" }] } } };
  const merged = mergeTexts(history, source);
  assert.deepEqual(listHistoryTexts(merged), [{ node: "93", text: "[]" }]);
  assert.deepEqual(listHistoryImages(merged).map((file) => file.filename), ["a.png"]);
  assert.equal(mergeTexts(history, null), history);
});
