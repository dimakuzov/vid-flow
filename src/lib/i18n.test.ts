import assert from "node:assert/strict";
import { test } from "node:test";
import { STAGES, type StageStatus } from "./series/constants";
import {
  DEFAULT_LANG,
  clockLocale,
  graphInputLabel,
  isLang,
  providerName,
  providerReason,
  readLang,
  stageName,
  statusName,
  t,
  type Translate,
} from "./i18n";

const en: Translate = (key, vars) => t("en", key, vars);
const ru: Translate = (key, vars) => t("ru", key, vars);

const STATUSES: StageStatus[] = ["empty", "prep", "agent", "queued", "running", "error", "review", "approved"];

test("язык по умолчанию — английский, ещё до выбора", () => {
  assert.equal(DEFAULT_LANG, "en");
  assert.equal(isLang("en"), true);
  assert.equal(isLang("ru"), true);
  assert.equal(isLang("de"), false);
  assert.equal(isLang(null), false);
  assert.equal(readLang(), "en");
  assert.equal(clockLocale("en"), "en-GB");
  assert.equal(clockLocale("ru"), "ru-RU");
});

test("одна и та же строка есть на обоих языках", () => {
  assert.equal(t("en", "header.add"), "Add");
  assert.equal(t("ru", "header.add"), "Добавить");
  assert.equal(t("en", "board.title"), "Shot table");
  assert.equal(t("ru", "board.title"), "Таблица кадров");
  assert.equal(t("en", "page.run"), "Run");
  assert.equal(t("ru", "hotkey.stage.run"), "Запустить");
});

test("подстановка не трогает отсутствующие имена", () => {
  assert.equal(t("en", "board.formatError", { error: "disk" }), "Scenario markup failed: disk");
  assert.equal(t("ru", "import.hidden", { id: "s01" }), "s01 скрыт из таблицы. Файлы кадра на месте.");
  assert.equal(t("en", "header.add", { unused: 1 }), "Add");
});

test("подписи этапов и статусов идут из словаря, id не меняются", () => {
  for (const id of STAGES) {
    assert.notEqual(stageName(en, id), stageName(ru, id));
    assert.equal(stageName(en, id).includes(id), false);
  }
  assert.equal(stageName(en, "nope"), "nope");
  for (const id of STATUSES) {
    assert.ok(statusName(en, id));
    assert.ok(statusName(ru, id));
    assert.notEqual(statusName(en, id), id);
  }
});

test("имена агентов и известные причины переводятся, чужой текст сервера остаётся", () => {
  assert.equal(providerName(en, "claude"), "Claude Code");
  assert.equal(providerName(ru, "ollama"), "Локальный агент (Ollama)");
  assert.equal(providerName(en, "custom", "Custom"), "Custom");
  assert.equal(providerReason(en, "В Ollama нет ни одной модели"), "Ollama has no models");
  assert.equal(providerReason(ru, "недоступен"), "недоступен");
  assert.equal(
    providerReason(en, "Не найден claude.cmd. Путь к CLI задаётся FRAMEBOARD_CLAUDE_BIN"),
    "claude.cmd was not found. Set the CLI path with FRAMEBOARD_CLAUDE_BIN",
  );
  assert.equal(providerReason(en, "something new"), "something new");
});

test("подписи персонажа и одежды переводятся, имя остаётся", () => {
  assert.equal(graphInputLabel(en, "Персонаж Lena"), "Character Lena");
  assert.equal(graphInputLabel(ru, "Одежда mark"), "Одежда mark");
  assert.equal(graphInputLabel(en, "image 1"), "image 1");
});
