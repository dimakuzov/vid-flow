"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/language";

type TransportState = { transport: "legacy" | "sdk"; locked: boolean };

const POLL_MS = 5000;

/** Как доска обращается к ComfyUI. Пока идёт генерация — заблокирован. */
export function TransportSwitch() {
  const t = useT();
  const [state, setState] = useState<TransportState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/comfy/transport", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<TransportState>) : null))
        .then((data) => {
          if (alive && data) setState(data);
        })
        .catch(() => {
          // Сервер недоступен: оставляем прежнее состояние.
        });
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  async function choose(transport: TransportState["transport"]) {
    if (!state || state.locked || state.transport === transport) return;
    setFailed(false);
    try {
      const res = await fetch("/api/comfy/transport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transport }),
      });
      const data = (await res.json()) as TransportState;
      if (data.transport) setState(data);
      if (!res.ok) setFailed(true);
    } catch {
      setFailed(true);
    }
  }

  if (!state) return null;
  const title = failed ? t("transport.failed") : state.locked ? t("transport.locked") : t("transport.label");
  return (
    <div
      role="group"
      aria-label={t("transport.label")}
      title={title}
      className={`flex h-9 items-center rounded-lg border bg-white/90 p-0.5 text-xs font-semibold ${
        failed ? "border-red-400" : "border-stone-300"
      } ${state.locked ? "opacity-60" : ""}`}
    >
      {(["legacy", "sdk"] as const).map((id) => (
        <button
          key={id}
          type="button"
          disabled={state.locked}
          aria-pressed={state.transport === id}
          onClick={() => void choose(id)}
          className={
            state.transport === id
              ? "h-8 rounded-md bg-teal-800 px-2.5 text-white"
              : "h-8 rounded-md px-2.5 text-stone-600 hover:text-stone-900 disabled:hover:text-stone-600"
          }
        >
          {t(id === "legacy" ? "transport.legacy" : "transport.sdk")}
        </button>
      ))}
    </div>
  );
}
