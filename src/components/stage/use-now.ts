"use client";

import { useSyncExternalStore } from "react";

// Одни часы на страницу: тик раз в секунду, пока есть подписчики.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const item of listeners) item();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Текущее время в мс; на сервере и при гидратации — null. */
export function useNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => null,
  );
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/** «3 мин 05 с», «1 ч 12 мин». */
export function formatElapsed(fromIso: string | null | undefined, nowMs: number | null): string {
  if (!fromIso || nowMs === null) return "";
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return "";
  const seconds = Math.max(0, Math.floor((nowMs - from) / 1000));
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин ${String(seconds % 60).padStart(2, "0")} с`;
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}
