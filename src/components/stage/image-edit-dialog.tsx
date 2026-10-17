"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/language";
import { Button } from "@/components/ui/button";
import type { MessageKey } from "@/lib/i18n";
import type { EditWorkflow } from "@/lib/comfy/edit";
import type { MediaFile } from "@/lib/series/types";
import { errorText } from "./api";

type Aspect = "free" | "9:16" | "16:9" | "1:1" | "source";

/** Доли кадра: x, y, ширина, высота от 0 до 1. */
interface Fraction {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ASPECTS: { id: Aspect; label: MessageKey | null }[] = [
  { id: "free", label: "edit.free" },
  { id: "9:16", label: null },
  { id: "16:9", label: null },
  { id: "1:1", label: null },
  { id: "source", label: "edit.source" },
];

function pixelRatio(aspect: Aspect, natural: { w: number; h: number }): number | null {
  if (aspect === "free") return null;
  if (aspect === "9:16") return 9 / 16;
  if (aspect === "16:9") return 16 / 9;
  if (aspect === "1:1") return 1;
  return natural.w / natural.h;
}

/** Прямоугольник нужной пропорции, вписанный в кадр и стоящий по центру. */
function fitAspect(aspect: Aspect, natural: { w: number; h: number }): Fraction {
  const ratio = pixelRatio(aspect, natural);
  if (ratio == null || !natural.w || !natural.h) return { x: 0, y: 0, w: 1, h: 1 };
  const frac = (ratio * natural.h) / natural.w;
  let w = 1;
  let h = w / frac;
  if (h > 1) {
    h = 1;
    w = h * frac;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Рамка на весь кадр: улучшение идёт по исходному файлу, отдельная обрезка не нужна. */
function isWholeFrame(value: Fraction): boolean {
  return value.x <= 0.004 && value.y <= 0.004 && value.x + value.w >= 0.996 && value.y + value.h >= 0.996;
}

/**
 * Окно «Править»: обрезка в браузере и правка моделью.
 * Исходный файл не отправляется как замена — обрезка уходит новым PNG.
 */
export function ImageEditDialog({
  file,
  folder,
  stageApi,
  workflows,
  onClose,
  onCropped,
  onEditQueued,
}: {
  file: MediaFile;
  folder: "output" | "approve";
  stageApi: string;
  workflows: EditWorkflow[];
  onClose: () => void;
  onCropped: (message: string) => void;
  onEditQueued: (message: string) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [rect, setRect] = useState<Fraction>({ x: 0, y: 0, w: 1, h: 1 });
  const [workflow, setWorkflow] = useState(workflows[0]?.id ?? "");
  const [megapixels, setMegapixels] = useState(
    workflows[0]?.megapixels != null ? String(workflows[0].megapixels) : "",
  );
  const [text, setText] = useState("");
  const t = useT();
  const [pending, setPending] = useState<"crop" | "edit" | null>(null);
  const [error, setError] = useState("");
  const drag = useRef<{ mode: "move" | "resize"; x: number; y: number; origin: Fraction } | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  function chooseAspect(next: Aspect) {
    setAspect(next);
    if (natural) setRect(fitAspect(next, natural));
  }

  function pointerFraction(event: React.PointerEvent): { x: number; y: number } | null {
    const img = imgRef.current;
    if (!img) return null;
    const box = img.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    };
  }

  function onPointerDown(event: React.PointerEvent, mode: "move" | "resize") {
    const point = pointerFraction(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { mode, x: point.x, y: point.y, origin: rect };
  }

  function onPointerMove(event: React.PointerEvent) {
    const current = drag.current;
    const point = pointerFraction(event);
    if (!current || !point || !natural) return;
    const dx = point.x - current.x;
    const dy = point.y - current.y;
    if (current.mode === "move") {
      setRect({
        ...current.origin,
        x: clamp(current.origin.x + dx, 0, 1 - current.origin.w),
        y: clamp(current.origin.y + dy, 0, 1 - current.origin.h),
      });
      return;
    }
    const ratio = pixelRatio(aspect, natural);
    let w = clamp(current.origin.w + dx, 0.05, 1 - current.origin.x);
    let h = clamp(current.origin.h + dy, 0.05, 1 - current.origin.y);
    if (ratio != null) {
      const frac = (ratio * natural.h) / natural.w;
      h = w / frac;
      if (current.origin.y + h > 1) {
        h = 1 - current.origin.y;
        w = h * frac;
      }
    }
    setRect({ x: current.origin.x, y: current.origin.y, w, h });
  }

  function onPointerUp() {
    drag.current = null;
  }

  /** Байты текущей рамки уходят новым PNG. Исходник остаётся. */
  async function uploadCrop(): Promise<{ savedAs: string; message?: string }> {
    const img = imgRef.current;
    if (!img || !natural) throw new Error(t("edit.notLoaded"));
    const canvas = document.createElement("canvas");
    const width = Math.max(1, Math.round(rect.w * natural.w));
    const height = Math.max(1, Math.round(rect.h * natural.h));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(t("edit.noCanvas"));
    context.drawImage(
      img,
      Math.round(rect.x * natural.w),
      Math.round(rect.y * natural.h),
      width,
      height,
      0,
      0,
      width,
      height,
    );
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error(t("edit.emptyCrop")))), "image/png");
    });
    const form = new FormData();
    form.set("file", blob, "crop.png");
    form.set("source", file.name);
    form.set("folder", folder);
    const res = await fetch(`${stageApi}/crop`, { method: "POST", body: form });
    const data = (await res.json()) as { error?: string; message?: string; savedAs?: string };
    if (!res.ok || !data.savedAs) throw new Error(data.error || t("edit.cropFailed"));
    return { savedAs: data.savedAs, message: data.message };
  }

  async function saveCrop() {
    setPending("crop");
    setError("");
    try {
      const saved = await uploadCrop();
      onCropped(saved.message || t("edit.cropSaved"));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(null);
    }
  }

  async function sendEdit() {
    const chosen = workflows.find((item) => item.id === workflow);
    const raw = megapixels.trim();
    const parsed = raw === "" ? undefined : Number(raw);
    if (parsed !== undefined && (!Number.isFinite(parsed) || parsed < 0.1 || parsed > 16)) {
      setError(t("edit.mpRange"));
      return;
    }
    setPending("edit");
    setError("");
    try {
      // Рамка не на весь кадр: сначала обрезка, улучшение берёт уже её.
      let filename = file.name;
      let editFolder: "output" | "approve" = folder;
      if (!isWholeFrame(rect)) {
        const saved = await uploadCrop();
        filename = saved.savedAs;
        editFolder = "output";
      }
      const res = await fetch(`${stageApi}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename,
          folder: editFolder,
          workflow,
          text,
          megapixels: parsed ?? chosen?.megapixels,
        }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error || t("edit.queueFailed"));
      onEditQueued(data.message || t("edit.queued"));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("edit.title", { name: file.name })}
        className="my-4 w-full max-w-3xl rounded-xl bg-white p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-stone-900">{t("edit.title", { name: file.name })}</h2>
        <p className="mt-1 text-xs text-stone-500">{t("edit.lead")}</p>

        <div className="mt-3 flex flex-wrap gap-1">
          {ASPECTS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={aspect === item.id}
              className={`rounded-md px-2 py-1 text-xs ${
                aspect === item.id ? "bg-teal-800 text-white" : "bg-stone-100 text-stone-700"
              }`}
              onClick={() => chooseAspect(item.id)}
            >
              {item.label ? t(item.label) : item.id}
            </button>
          ))}
        </div>

        <div className="mt-3 flex justify-center">
          <div className="relative inline-block max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- холст читает пиксели этого img */}
            <img
              ref={imgRef}
              src={file.url}
              alt={file.name}
              className="block max-h-[50vh] max-w-full"
              onLoad={(event) => {
                const size = { w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight };
                setNatural(size);
                setRect(fitAspect(aspect, size));
              }}
            />
            {natural ? (
              <div
                className="absolute cursor-move border border-white"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
                }}
                onPointerDown={(event) => onPointerDown(event, "move")}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                <button
                  type="button"
                  aria-label={t("edit.corner")}
                  className="absolute right-0 bottom-0 size-3 translate-x-1/2 translate-y-1/2 cursor-nwse-resize rounded-sm bg-white"
                  onPointerDown={(event) => onPointerDown(event, "resize")}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                />
              </div>
            ) : null}
          </div>
        </div>
        <Button type="button" className="mt-3" disabled={pending !== null || !natural} onClick={() => void saveCrop()}>
          {pending === "crop" ? t("edit.saving") : t("edit.saveCrop")}
        </Button>

        <div className="mt-6 space-y-2 border-t border-stone-200 pt-4">
          <h3 className="text-sm font-medium text-stone-900">{t("edit.enhance")}</h3>
          <p className="text-xs text-stone-500">{t("edit.enhanceLead")}</p>
          <label className="block text-xs text-stone-600">
            {t("edit.what")}
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("edit.placeholder")}
              className="mt-1 min-h-20 w-full rounded-lg border border-stone-300 px-2 py-2 text-sm text-stone-900"
            />
          </label>
          <label className="block text-xs text-stone-600">
            {t("edit.mp")}
            <input
              type="number"
              min={0.1}
              max={16}
              step={0.1}
              value={megapixels}
              onChange={(event) => setMegapixels(event.target.value)}
              className="mt-1 h-9 w-32 rounded-lg border border-stone-300 px-2 text-sm text-stone-900"
            />
          </label>
          <p className="text-xs text-stone-500">
            {t("edit.mpHint", { n: workflows.find((item) => item.id === workflow)?.megapixels ?? "—" })}
          </p>
          <label className="block text-xs text-stone-600">
            {t("edit.workflow")}
            <select
              value={workflow}
              onChange={(event) => {
                const next = event.target.value;
                setWorkflow(next);
                const item = workflows.find((entry) => entry.id === next);
                if (item) setMegapixels(String(item.megapixels));
              }}
              className="mt-1 h-9 w-full rounded-lg border border-stone-300 bg-white px-2 text-sm"
            >
              {workflows.length ? null : <option value="">{t("edit.noWorkflow")}</option>}
              {workflows.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {workflows.find((item) => item.id === workflow)?.description ? (
            <p className="text-xs text-stone-500">{workflows.find((item) => item.id === workflow)?.description}</p>
          ) : null}
          <Button
            type="button"
            disabled={pending !== null || !workflow || !natural}
            onClick={() => void sendEdit()}
          >
            {pending === "edit" ? t("edit.queueing") : t("edit.apply")}
          </Button>
        </div>

        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        <button type="button" className="mt-4 text-sm text-stone-500 underline" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}
