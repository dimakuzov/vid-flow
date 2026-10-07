"use client";

import { useEffect, useRef, useState } from "react";

/** Столько места под кнопкой хватает, чтобы меню не открывать вверх. */
const MIN_ROOM = 420;

/**
 * Меню у кнопки в таблице: fixed поверх страницы, иначе таблица с прокруткой обрезала бы его снизу.
 * Прокрутка страницы или таблицы и смена размера окна уводят кнопку — меню закрывается.
 */
export function useFloatingMenu(width: number) {
  // top — меню под кнопкой, bottom — над ней (внизу экрана мало места). maxHeight — сколько есть.
  const [anchor, setAnchor] = useState<
    { top?: number; bottom?: number; left: number; maxHeight: number } | null
  >(null);
  const open = anchor !== null;
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setAnchor(null);
    // Прокрутка внутри меню его не закрывает.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return {
    anchor,
    open,
    menuRef,
    toggle(button: HTMLButtonElement) {
      if (open) {
        setAnchor(null);
        return;
      }
      const rect = button.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      if (below >= MIN_ROOM || below >= above) setAnchor({ top: rect.bottom + 4, left, maxHeight: below });
      else setAnchor({ bottom: window.innerHeight - rect.top + 4, left, maxHeight: above });
    },
    close() {
      setAnchor(null);
    },
  };
}
