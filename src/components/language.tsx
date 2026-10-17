"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_LANG,
  LANG_EVENT,
  LANG_STORAGE_KEY,
  readLang,
  t as translate,
  type Lang,
  type MessageKey,
  type Translate,
  type Vars,
} from "@/lib/i18n";

function subscribe(onStoreChange: () => void) {
  const onChange = () => onStoreChange();
  window.addEventListener("storage", onChange);
  window.addEventListener(LANG_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(LANG_EVENT, onChange);
  };
}

/** Язык из браузера. До гидратации и без сохранённого выбора — английский. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, readLang, () => DEFAULT_LANG);
}

/** Строка интерфейса на текущем языке. */
export function useT(): Translate {
  const lang = useLang();
  return useCallback((key: MessageKey, vars?: Vars) => translate(lang, key, vars), [lang]);
}

/** Запомнить язык в этом браузере. На диск серии и в API ничего не пишется. */
export function setLang(lang: Lang) {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Выбор просто не запомнится.
  }
  document.documentElement.lang = lang;
  window.dispatchEvent(new Event(LANG_EVENT));
}

/** Держит lang у <html> вместе с выбором. Первый ответ сервера остаётся английским. */
export function LangAttr() {
  const lang = useLang();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return null;
}

/** Переключатель в шапке: только язык, без сохранения серии и без запуска. */
export function LanguageSwitch() {
  const lang = useLang();
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t("lang.label")}
      className="flex h-9 items-center rounded-lg border border-stone-300 bg-white/90 p-0.5 text-xs font-semibold"
    >
      {(["en", "ru"] as const).map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={lang === id}
          onClick={() => setLang(id)}
          className={
            lang === id
              ? "h-8 rounded-md bg-teal-800 px-2.5 text-white"
              : "h-8 rounded-md px-2.5 text-stone-600 hover:text-stone-900"
          }
        >
          {id === "en" ? "EN" : "RU"}
        </button>
      ))}
    </div>
  );
}
