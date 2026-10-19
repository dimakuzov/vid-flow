// Номер сцены задаёт кадр: название после номера и порядок реплик модель не переписывает.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScenario } from "./bootstrap";
import { formatLawNote, lockFormattedScenario, rawSceneText, rawScenes } from "./format-guard";

const RAW = `Episode 5.
1. ИНТ. Кухня — вечер
Лена входит.
LENA
Мама, я дома.
MAMA
Иди ужинать.
2. НАТ. Улица — ночь
2A. CLOSE UP
Пустая улица.
`;

test("номер сцены: название дословно, реплики по порядку, ракурс не дробит сцену", () => {
  const scenes = rawScenes(RAW);
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].title, "ИНТ. Кухня — вечер");
  assert.deepEqual(scenes[0].speeches, ["LENA: Мама, я дома.", "MAMA: Иди ужинать."]);
  assert.equal(scenes[1].title, "НАТ. Улица — ночь");
  assert.deepEqual(scenes[1].speeches, []);
  assert.match(scenes[1].text, /2A\. CLOSE UP/);
  assert.match(scenes[0].text, /ИНТ\. Кухня — вечер/);
  assert.equal(rawSceneText(RAW, "s01").startsWith("1. ИНТ. Кухня — вечер"), true);
});

test("ответ модели с чужими названиями и переставленными репликами возвращается к тексту", () => {
  const model = `# Выдумка

## s01 Ужин
- characters: lena, mama
- location: kitchen
- duration: 6
- speech: MAMA: Иди ужинать.
- speech: LENA: Мама, я дома.
Лена дома.

## s02 Лишний кадр
Ещё.

## s03 Дорога
- location: street
Пусто.
`;
  const parsed = parseScenario(model);
  const locked = lockFormattedScenario(RAW, model, parsed.shots, parsed.seriesTitle);
  const shots = parseScenario(locked).shots;
  assert.equal(shots.length, 2, "лишний кадр убран, сцена не разрезана");
  assert.equal(shots[0].title, "ИНТ. Кухня — вечер");
  assert.deepEqual(shots[0].speech, ["LENA: Мама, я дома.", "MAMA: Иди ужинать."]);
  assert.equal(shots[1].title, "НАТ. Улица — ночь");
  assert.equal(shots[0].location, "", "раздробленный ответ не привязывается к кадрам");
});

test("если модель не дробит сцены, локация и действие остаются, реплики — из текста", () => {
  const model = `# Episode 5

## s01 Ужин
- characters: lena, mama
- location: kitchen
- duration: 6
- speech: MAMA: Иди ужинать.
- speech: LENA: Мама, я дома.
Лена входит на кухню.

## s02 Дорога
- location: street
Пустая улица ночью.
`;
  const parsed = parseScenario(model);
  const shots = parseScenario(lockFormattedScenario(RAW, model, parsed.shots, parsed.seriesTitle)).shots;
  assert.equal(shots[0].title, "ИНТ. Кухня — вечер");
  assert.deepEqual(shots[0].characters, ["lena", "mama"]);
  assert.equal(shots[0].location, "kitchen");
  assert.equal(shots[0].durationSec, 6);
  assert.equal(shots[0].summary, "Лена входит на кухню.");
  assert.deepEqual(shots[0].speech, ["LENA: Мама, я дома.", "MAMA: Иди ужинать."]);
});

test("без названия после номера остаётся название модели", () => {
  const raw = "1.\nLENA\nТихо.\n";
  const model = "## s01 Тишина\n- characters: lena\nЛена молчит.";
  const parsed = parseScenario(model);
  const shots = parseScenario(lockFormattedScenario(raw, model, parsed.shots, parsed.seriesTitle)).shots;
  assert.equal(shots[0].title, "Тишина");
  assert.deepEqual(shots[0].speech, ["LENA: Тихо."]);
});

test("текст без номеров сцен моделью не переписывается", () => {
  const raw = "Катя входит в кафе. Потом улица.";
  const model = "## s01 Кафе\nКатя входит.";
  assert.equal(lockFormattedScenario(raw, model, [], ""), model);
  assert.equal(formatLawNote(raw), "");
});

test("ремарка в скобках не становится репликой и не сдвигает порядок", () => {
  const scenes = rawScenes("1. Сон\nLENA\n(anxious)\n- That dream again...\nJULIA\nOh, it's nothing.\n");
  assert.deepEqual(scenes[0].speeches, ["LENA: That dream again...", "JULIA: Oh, it's nothing."]);
});

test("повтор номера — одна сцена, реплики подряд", () => {
  const raw = "1. Кухня\nLENA\nРаз.\n1. Кухня\nMAMA\nДва.\n";
  const scenes = rawScenes(raw);
  assert.equal(scenes.length, 1);
  assert.deepEqual(scenes[0].speeches, ["LENA: Раз.", "MAMA: Два."]);
});

test("подсказка называет законные названия и порядок реплик", () => {
  const note = formatLawNote(RAW);
  assert.match(note, /s01: ИНТ\. Кухня — вечер/);
  assert.match(note, /LENA: Мама, я дома\./);
  assert.match(note, /MAMA: Иди ужинать\./);
  const lena = note.indexOf("LENA:");
  const mama = note.indexOf("MAMA:");
  assert.ok(lena < mama, "порядок реплик как в тексте");
});
