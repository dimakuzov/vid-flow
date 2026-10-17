"use client";

import { useEffect } from "react";
import { HOTKEYS } from "@/components/hotkeys";
import { useT } from "@/components/language";

/** Список клавиш. Открывается по «?» и по кнопке на странице этапа. */
export function HotkeyHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  const scopes = ["stage", "board"] as const;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("hotkey.title")}
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-stone-900">{t("hotkey.title")}</h2>
        {scopes.map((scope) => (
          <section key={scope} className="mt-3">
            <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-stone-500">
              {t(scope === "stage" ? "hotkey.scope.stage" : "hotkey.scope.board")}
            </h3>
            <ul className="mt-1 space-y-1">
              {HOTKEYS.filter((item) => item.scope === scope).map((item) => (
                <li key={`${scope}-${item.keys}-${item.action}`} className="flex gap-3 text-sm text-stone-800">
                  <kbd className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs">{item.keys}</kbd>
                  <span>{t(item.action)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <button type="button" className="mt-4 text-sm text-teal-800 underline" onClick={onClose}>
          {t("hotkey.close")}
        </button>
      </div>
    </div>
  );
}
