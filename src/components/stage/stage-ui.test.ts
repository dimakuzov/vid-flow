import assert from "node:assert/strict";
import { test } from "node:test";
import zlib from "node:zlib";
import type { StageDetail } from "../../lib/series/types";
import { comfyRunContext, readPngTextChunks } from "./png-metadata";
import {
  cleanFields,
  hasDiskConflict,
  stageDocsReducer,
  type StageDocsState,
} from "./use-stage-detail";

function detailWith(prompt: string, llmNotes = ""): StageDetail {
  return {
    docs: { prompt, llmNotes, refs: "", workflow: "", runLog: "" },
  } as StageDetail;
}

function initial(prompt: string): StageDocsState {
  const detail = detailWith(prompt);
  return { detail, fields: cleanFields(detail) };
}

test("опрос подтягивает файл в нетронутое поле", () => {
  const next = stageDocsReducer(initial("old"), { type: "merge", detail: detailWith("agent wrote") });
  assert.equal(next.fields.prompt.value, "agent wrote");
  assert.equal(next.fields.prompt.dirty, false);
});

test("правка поля не затирается опросом, а изменение на диске даёт плашку", () => {
  let state = stageDocsReducer(initial("old"), { type: "edit", field: "prompt", value: "mine" });
  state = stageDocsReducer(state, { type: "merge", detail: detailWith("old") });
  assert.equal(state.fields.prompt.value, "mine");
  assert.equal(hasDiskConflict(state.fields.prompt, "old"), false);

  state = stageDocsReducer(state, { type: "merge", detail: detailWith("agent wrote") });
  assert.equal(state.fields.prompt.value, "mine");
  assert.equal(hasDiskConflict(state.fields.prompt, "agent wrote"), true);

  const pulled = stageDocsReducer(state, { type: "pull", field: "prompt" });
  assert.equal(pulled.fields.prompt.value, "agent wrote");
  assert.equal(pulled.fields.prompt.dirty, false);

  const kept = stageDocsReducer(state, { type: "keep", field: "prompt" });
  assert.equal(kept.fields.prompt.value, "mine");
  assert.equal(hasDiskConflict(kept.fields.prompt, "agent wrote"), false);
});

test("поле, вручную возвращённое к старому тексту, остаётся локальным", () => {
  // Сравнение строк здесь бы ошиблось: текст совпадает с прошлым диском, но поле правили.
  let state = stageDocsReducer(initial("same"), { type: "edit", field: "prompt", value: "x" });
  state = stageDocsReducer(state, { type: "edit", field: "prompt", value: "same" });
  state = stageDocsReducer(state, { type: "merge", detail: detailWith("agent wrote") });
  assert.equal(state.fields.prompt.value, "same");
  assert.equal(hasDiskConflict(state.fields.prompt, "agent wrote"), true);
});

test("после сохранения поля берутся из ответа", () => {
  let state = stageDocsReducer(initial("a"), { type: "edit", field: "llmNotes", value: "note" });
  state = stageDocsReducer(state, { type: "reset", detail: detailWith("a", "") });
  assert.equal(state.fields.llmNotes.value, "");
  assert.equal(state.fields.llmNotes.dirty, false);
});

function crc32(bytes: Buffer): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function pngWithText(entries: Record<string, string>, itxt: Record<string, string> = {}): ArrayBuffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...Object.entries(entries).map(([key, value]) =>
      chunk("tEXt", Buffer.concat([Buffer.from(key, "latin1"), Buffer.from([0]), Buffer.from(value, "utf8")])),
    ),
    ...Object.entries(itxt).map(([key, value]) =>
      chunk(
        "iTXt",
        Buffer.concat([Buffer.from(key, "latin1"), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(value, "utf8")]),
      ),
    ),
    chunk("IDAT", zlib.deflateSync(Buffer.from([0, 0]))),
    chunk("IEND", Buffer.alloc(0)),
  ];
  const buffer = Buffer.concat(parts);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

test("промпт и seed из PNG ComfyUI", () => {
  const prompt = {
    "6": { class_type: "CLIPTextEncode", inputs: { text: "Катя входит в кафе", clip: ["4", 0] } },
    "3": { class_type: "KSampler", inputs: { seed: 42, steps: 4 } },
    "10": { class_type: "RandomNoise", inputs: { noise_seed: 7 } },
  };
  const chunks = readPngTextChunks(pngWithText({ prompt: JSON.stringify(prompt), workflow: "{}" }));
  const context = comfyRunContext(chunks);
  assert.ok(context);
  assert.deepEqual(context.texts.map((item) => item.text), ["Катя входит в кафе"]);
  assert.deepEqual(
    context.seeds.map((item) => [item.node, item.value]),
    [
      ["3", 42],
      ["10", 7],
    ],
  );
  assert.equal(context.hasWorkflow, true);
});

test("iTXt читается, PNG без графа и не PNG — пусто", () => {
  const chunks = readPngTextChunks(pngWithText({}, { prompt: "{}" }));
  assert.equal(chunks.prompt, "{}");
  assert.equal(comfyRunContext(readPngTextChunks(pngWithText({ Software: "x" }))), null);
  assert.deepEqual(readPngTextChunks(new ArrayBuffer(4)), {});
});
