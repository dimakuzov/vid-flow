// Чистые функции поста: куски текста, поиск реплик в таймстемпах, границы по тишине, группы звука.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkLines, lineSeparator, locateLines, refineBounds, type Alignment } from "./align";
import { autoPlaceShot, groupSounds, parseSpeechLines } from "./lines";

function alignmentFor(text: string, spans: { from: number; to: number; start: number; end: number }[]): Alignment {
  const characters = [...text];
  const starts: number[] = [];
  const ends: number[] = [];
  characters.forEach((_, index) => {
    const span = spans.find((item) => index >= item.from && index < item.to);
    if (span) {
      const step = (span.end - span.start) / (span.to - span.from);
      starts.push(span.start + step * (index - span.from));
      ends.push(span.start + step * (index - span.from + 1));
    } else {
      const last = ends[ends.length - 1] ?? 0;
      starts.push(last);
      ends.push(last);
    }
  });
  return { characters, character_start_times_seconds: starts, character_end_times_seconds: ends };
}

test("speech.md: имя перед двоеточием, без имени — единственный персонаж кадра, кавычки снимаются", () => {
  assert.deepEqual(parseSpeechLines('Julia: "It\'s just me."\n\n- Lena: Did he throw you out too?\n', ["Julia", "Lena"]), [
    { index: 1, character: "Julia", text: "It's just me." },
    { index: 2, character: "Lena", text: "Did he throw you out too?" },
  ]);
  assert.deepEqual(parseSpeechLines("Maybe there are two of them.", ["Julia"]), [
    { index: 1, character: "Julia", text: "Maybe there are two of them." },
  ]);
  assert.equal(parseSpeechLines("No name here.", ["Julia", "Lena"])[0].character, "");
});

test("куски: реплика не режется, разделитель — <break> для v2 и пустая строка для v3", () => {
  const lines = [{ text: "a".repeat(30) }, { text: "b".repeat(30) }, { text: "c".repeat(10) }];
  const chunks = chunkLines(lines, "eleven_multilingual_v2", 90);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].items.length, 2);
  assert.ok(chunks[0].text.includes('<break time="1.0s" />'));
  assert.equal(lineSeparator("eleven_v3"), "\n\n");
  assert.equal(chunkLines(lines, "eleven_multilingual_v2", 5).length, 3, "реплика длиннее лимита идёт отдельным куском");
});

test("реплики находятся в таймстемпах по порядку, теги паузы пропускаются", () => {
  const sep = lineSeparator("eleven_multilingual_v2");
  const first = "Don't mind him.";
  const second = "But why?";
  const text = `${first}${sep}${second}`;
  const secondFrom = first.length + sep.length;
  const alignment = alignmentFor(text, [
    { from: 0, to: first.length, start: 0.1, end: 1.1 },
    { from: secondFrom, to: text.length, start: 2.2, end: 2.9 },
  ]);
  const found = locateLines(alignment, [first, second]);
  assert.equal(found.length, 2);
  assert.ok(Math.abs(found[0].start - 0.1) < 1e-6 && Math.abs(found[0].end - 1.1) < 1e-6);
  assert.ok(Math.abs(found[1].start - 2.2) < 1e-6 && Math.abs(found[1].end - 2.9) < 1e-6);
});

test("границы: край звука по тишине, запас, не дальше середины паузы, без перекрытия", () => {
  // Звук: 0.1–1.3 (таймстемп конца 1.1 — затухание после), 2.2–2.9.
  const silences = [
    { start: 0, end: 0.1 },
    { start: 1.3, end: 2.2 },
    { start: 2.9, end: 3.5 },
  ];
  const bounds = refineBounds(
    [
      { start: 0.12, end: 1.1 },
      { start: 2.25, end: 2.85 },
    ],
    silences,
    3.5,
  );
  assert.equal(bounds[0].speechEnd, 1.3, "конец звука — начало тишины, а не таймстемп");
  assert.equal(bounds[1].speechStart, 2.2, "начало звука — конец тишины");
  assert.equal(bounds[0].in, 0, "первая реплика — не раньше начала файла");
  assert.equal(bounds[0].out, 1.5);
  assert.equal(bounds[1].in, 2.08);
  assert.equal(bounds[1].out, 3.1);
  assert.ok(bounds[0].out <= bounds[1].in);

  // Пауза короткая: запас упирается в середину.
  const tight = refineBounds(
    [
      { start: 0.1, end: 1 },
      { start: 1.1, end: 2 },
    ],
    [],
    2.5,
  );
  assert.equal(tight[0].out, 1.05);
  assert.equal(tight[1].in, 1.05);
});

test("звук финала → места реплик: самые длинные паузы — смена говорящего", () => {
  const sounds = [
    { start: 0.2, end: 1.0 },
    { start: 1.15, end: 2.0 }, // короткая пауза внутри первой реплики
    { start: 2.8, end: 3.5 },
  ];
  assert.deepEqual(groupSounds(sounds, 2), [
    { start: 0.2, end: 2.0 },
    { start: 2.8, end: 3.5 },
  ]);
  const lines = [
    { at: 0, atManual: false, text: "one" },
    { at: 5, atManual: true, text: "two" },
    { at: 0, atManual: false, text: "three" },
  ];
  // Звука нет: подряд, ручное место остаётся, следующая — за ручной.
  assert.deepEqual(autoPlaceShot(lines, null, () => 1), [0.3, 5, 6.4]);
  // Звук есть: по группам.
  assert.deepEqual(autoPlaceShot(lines, sounds, () => 1), [0.2, 5, 2.8]);
});
