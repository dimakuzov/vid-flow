"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useT } from "@/components/language";
import type { MediaFile } from "@/lib/series/types";
import { comfyRunContext, readPngTextChunks, type ComfyRunContext } from "./png-metadata";

type MetaState =
  | { url: string; status: "loading" }
  | { url: string; status: "ready"; context: ComfyRunContext | null }
  | { url: string; status: "error" };

/** Промпт и seed из PNG, который сохранил ComfyUI. Читается по кнопке, в браузере. */
function RunContextPanel({ file }: { file: MediaFile }) {
  const t = useT();
  const [meta, setMeta] = useState<MetaState | null>(null);
  const current = meta && meta.url === file.url ? meta : null;

  async function load() {
    const url = file.url;
    setMeta({ url, status: "loading" });
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const context = comfyRunContext(readPngTextChunks(await res.arrayBuffer()));
      setMeta({ url, status: "ready", context });
    } catch {
      setMeta({ url, status: "error" });
    }
  }

  if (!current) {
    return (
      <button
        type="button"
        className="rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white"
        onClick={load}
      >
        {t("light.prompt")}
      </button>
    );
  }
  if (current.status === "loading") return <p className="text-sm text-white/70">{t("light.reading")}</p>;
  if (current.status === "error") return <p className="text-sm text-red-200">{t("light.unread")}</p>;
  if (!current.context) {
    return <p className="text-sm text-white/70">{t("light.noGraph")}</p>;
  }
  const { texts, seeds } = current.context;
  return (
    <div className="max-h-[50vh] space-y-3 overflow-y-auto text-sm text-white">
      {texts.length ? (
        <div className="space-y-2">
          {texts.map((item) => (
            <div key={`${item.node}.${item.field}`}>
              <div className="text-xs text-white/60">
                {item.classType || t("light.node")} #{item.node} · {item.field}
              </div>
              <p className="whitespace-pre-wrap break-words">{item.text}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-white/70">{t("light.noText")}</p>
      )}
      {seeds.length ? (
        <ul className="space-y-0.5 text-xs text-white/80">
          {seeds.map((item) => (
            <li key={`${item.node}.${item.field}`}>
              {item.field} {item.value} · {item.classType || t("light.node")} #{item.node}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ImageLightbox({
  files,
  index,
  onClose,
  onIndex,
  showRunContext,
  actions,
}: {
  files: MediaFile[];
  index: number;
  onClose: () => void;
  onIndex: (next: number) => void;
  /** Показать кнопку «Промпт и seed» (для output/approve: PNG из ComfyUI). */
  showRunContext?: boolean;
  /** Кнопки для текущего файла в нижней панели. */
  actions?: (file: MediaFile) => ReactNode;
}) {
  const t = useT();
  const file = files[index];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onIndex(Math.min(files.length - 1, index + 1));
      if (event.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files.length, index, onClose, onIndex]);

  if (!file) return null;
  const isPng = /\.png$/i.test(file.name);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      onClick={onClose}
    >
      {file.kind === "video" ? (
        <video
          key={file.url}
          src={file.url}
          controls
          autoPlay
          className="max-h-full max-w-full object-contain"
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element -- полноразмерный просмотр без оптимизации */
        <img
          src={file.url}
          alt={file.name}
          className="max-h-full max-w-full object-contain"
          onClick={(event) => event.stopPropagation()}
        />
      )}
      <div
        className="absolute inset-x-0 bottom-0 space-y-3 bg-black/70 px-4 py-3 text-sm text-white"
        onClick={(event) => event.stopPropagation()}
      >
        {showRunContext && isPng ? <RunContextPanel key={file.url} file={file} /> : null}
        <div className="flex items-center justify-between gap-3">
          <span className="truncate">{file.name}</span>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions(file)}</div> : null}
          <span className="shrink-0 text-white/70">
            {index + 1} / {files.length}
          </span>
        </div>
      </div>
      <button
        type="button"
        className="absolute top-4 right-4 rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white"
        onClick={onClose}
      >
        {t("light.close")}
      </button>
    </div>
  );
}
