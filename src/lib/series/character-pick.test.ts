// Нажатия «Из референса» и других кнопок идут по кругу: следующая картинка, после последней — первая.
import assert from "node:assert/strict";
import { test } from "node:test";
import { nextPickIndex, pickPosition } from "./character-pick";

const refs = ["refs/a.png", "refs/b.png", "refs/c.png"];

test("первое нажатие берёт первую картинку, дальше по кругу", () => {
  assert.equal(nextPickIndex(refs, null), 0);
  assert.equal(nextPickIndex(refs, "refs/a.png"), 1);
  assert.equal(nextPickIndex(refs, "refs/b.png"), 2);
  assert.equal(nextPickIndex(refs, "refs/c.png"), 0);
});

test("текущая картинка не из этого списка (база из библиотеки): начинаем с первой", () => {
  assert.equal(nextPickIndex(refs, "characters/man_ptu/man_ptu_body.png"), 0);
});

test("одна картинка: каждое нажатие даёт её же", () => {
  assert.equal(nextPickIndex(["refs/only.png"], null), 0);
  assert.equal(nextPickIndex(["refs/only.png"], "refs/only.png"), 0);
});

test("пустой список: нажимать нечего", () => {
  assert.equal(nextPickIndex([], null), -1);
  assert.equal(nextPickIndex([], "refs/a.png"), -1);
});

test("номер текущей картинки для подписи кнопки", () => {
  assert.equal(pickPosition(refs, "refs/b.png"), 2);
  assert.equal(pickPosition(refs, "other.png"), 0);
  assert.equal(pickPosition(refs, null), 0);
});
