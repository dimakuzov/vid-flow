// Подгонка под губы: слова Whisper ↔ реплики, скорость в пределах. Текстовые выходы ComfyUI.
import assert from "node:assert/strict";
import { test } from "node:test";
import { listHistoryTexts } from "../comfy/client";
import { alignLinesToWords, fitSpeed, MAX_SPEED, MIN_SPEED, tokens } from "./speech-fit";

const w = (value: string, start: number, end: number) => ({ value, start, end });

test("слова: регистр, пунктуация и апострофы не мешают", () => {
  assert.deepEqual(tokens("Don't mind him. He just wants the attention!"), ["don't", "mind", "him", "he", "just", "wants", "the", "attention"]);
  assert.deepEqual(tokens("…like to imagine things. I like fantasy fiction…"), ["like", "to", "imagine", "things", "i", "like", "fantasy", "fiction"]);
});

test("рамки реплик по словам Whisper: порядок, лишние слова, неточное распознавание", () => {
  const words = [
    w("Um,", 0.1, 0.2),
    w("It's", 0.3, 0.45),
    w("just", 0.45, 0.6),
    w("me.", 0.6, 0.85),
    w("Did", 1.8, 1.95),
    w("he", 1.95, 2.0),
    w("through", 2.0, 2.2), // Whisper услышал «through» вместо «throw»
    w("you", 2.2, 2.3),
    w("out", 2.3, 2.45),
    w("too?", 2.45, 2.8),
    w("I", 3.4, 3.5),
    w("just", 3.5, 3.7),
    w("wanted", 3.7, 4.0),
    w("to", 4.0, 4.1),
    w("keep", 4.1, 4.3),
    w("talking", 4.3, 4.6),
  ];
  const windows = alignLinesToWords(
    ["It's just me.", "Did he throw you out too?", "I just wanted to keep talking to you. You're the first person here."],
    words,
  );
  assert.deepEqual(
    windows.map((item) => item && [item.start, item.end]),
    [
      [0.3, 0.85],
      [1.8, 2.8],
      [3.4, 4.6],
    ],
  );
  assert.equal(windows[1]!.matched, 5, "«through» ≠ «throw» — одно слово не совпало, рамка всё равно есть");
});

test("реплика, которой нет в речи видео, остаётся без рамки", () => {
  const windows = alignLinesToWords(["Hello there.", "Completely different words here."], [w("Hello", 0, 0.3), w("there", 0.3, 0.6)]);
  assert.deepEqual(windows[0] && [windows[0].start, windows[0].end], [0, 0.6]);
  assert.equal(windows[1], null);
});

test("скорость: длиннее рамки — быстрее, короче — медленнее, в пределах", () => {
  assert.deepEqual(fitSpeed(2.4, 2), { speed: 1.2, wanted: 1.2, clamped: false });
  assert.deepEqual(fitSpeed(1.8, 2), { speed: 0.9, wanted: 0.9, clamped: false });
  assert.deepEqual(fitSpeed(4, 2), { speed: MAX_SPEED, wanted: 2, clamped: true });
  assert.deepEqual(fitSpeed(1, 2), { speed: MIN_SPEED, wanted: 0.5, clamped: true });
  assert.deepEqual(fitSpeed(1, 0), { speed: 1, wanted: 1, clamped: false });
});

test("текстовые выходы нод из истории ComfyUI (PreviewAny)", () => {
  assert.deepEqual(
    listHistoryTexts({ outputs: { "92": { text: ["Hello"] }, "98": { text: ['[{"value":"Hello","start":0,"end":0.4}]'] }, "5": { images: [] } } }),
    [
      { node: "92", text: "Hello" },
      { node: "98", text: '[{"value":"Hello","start":0,"end":0.4}]' },
    ],
  );
});
