"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STATUS_LABELS, type StageId } from "@/lib/series/constants";
import type { StageSummary } from "@/lib/series/types";
import { StatusPill } from "./status-pill";

interface StageCellProps {
  shotId: string;
  stageId: StageId;
  stage: StageSummary;
  onChanged: () => void;
}

export function StageCell({ shotId, stageId, stage, onChanged }: StageCellProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadMode, setUploadMode] = useState<"output" | "approve">("output");
  const [videoWorkflow, setVideoWorkflow] = useState<"i2v" | "flf">("i2v");

  async function runAction() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/shots/${shotId}/stages/${stageId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          stageId === "video_preview" || stageId === "final_render" ? { workflow: videoWorkflow } : {},
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось запустить");
      setMessage(data.message || "Запущено");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function cancelAction() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/shots/${shotId}/stages/${stageId}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось отменить");
      setMessage(data.message || "Отменено");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function onFileSelected(file: File | null) {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("target", "output");
      form.set("approveAfter", uploadMode === "approve" ? "true" : "false");
      const res = await fetch(`/api/shots/${shotId}/stages/${stageId}/upload`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось загрузить");
      setMessage(
        uploadMode === "approve"
          ? `Загружено и утверждено: ${data.approvedAs || data.savedAs}`
          : `Загружено в output: ${data.savedAs}`,
      );
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function approveFirstOutput() {
    const outputNames = stage.outputNames ?? [];
    const filenames =
      stageId === "characters"
        ? outputNames
        : stage.thumbnails[0] && !stage.thumbnails[0].relativePath.includes("/approve/")
          ? [stage.thumbnails[0].name]
          : [];
    if (!filenames.length) {
      setMessage(
        stage.outputCount
          ? "Новый вариант в output. Откройте «Редактировать», отметьте имя файла и нажмите «Утвердить выбранные»."
          : "Нет файлов для утверждения. Сначала загрузите вариант.",
      );
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/shots/${shotId}/stages/${stageId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filenames, from: "output" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось утвердить");
      const approved = data.approved?.join(", ");
      setMessage(
        stageId === "characters" && data.stage?.status !== "approved"
          ? `В approve: ${approved}. Этап станет утверждённым, когда файл будет у каждого персонажа.`
          : `Утверждено: ${approved}`,
      );
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group flex h-full min-h-28 w-full flex-col gap-2 rounded-xl border p-3 text-left transition ${
          stage.busy
            ? "border-sky-400/60 bg-sky-50/70"
            : "border-stone-300/70 bg-white/70 hover:border-teal-600/40 hover:bg-white"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <StatusPill status={stage.status} />
          <span className="text-[11px] text-stone-500">
            {stage.approveCount}/{stage.expectedApproveCount}
          </span>
        </div>

        {stage.busy && stage.phaseSince ? (
          <p className="text-[11px] text-sky-900" suppressHydrationWarning>с {formatSince(stage.phaseSince)}</p>
        ) : null}
        {stage.status === "error" && stage.phaseError ? (
          <p className="line-clamp-3 text-[11px] leading-snug text-red-800">{stage.phaseError}</p>
        ) : null}

        {stage.thumbnails.length > 0 ? (
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {stage.thumbnails.slice(0, 3).map((file) =>
                file.kind === "image" ? (
                  <Image
                    key={file.relativePath}
                    src={file.url}
                    alt={file.name}
                    width={72}
                    height={128}
                    unoptimized
                    className="h-32 w-[4.5rem] rounded-md border border-white object-cover object-top shadow-sm"
                  />
                ) : (
                  <div
                    key={file.relativePath}
                    className="flex h-32 w-[4.5rem] items-center justify-center rounded-md border border-white bg-stone-900 text-[10px] text-white shadow-sm"
                  >
                    VID
                  </div>
                ),
              )}
            </div>
            <span className="text-xs text-stone-600">
              {stage.outputCount > 0
                ? `${stage.outputCount} в output`
                : STATUS_LABELS[stage.status]}
            </span>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-stone-500">
            {stage.status === "empty"
              ? "Нет материалов"
              : STATUS_LABELS[stage.status]}
          </p>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {shotId} · действие
            </DialogTitle>
            <DialogDescription>
              Выберите, что сделать с этапом. Полная страница откроется только по
              «Редактировать».
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setUploadMode("output");
                fileRef.current?.click();
              }}
            >
              Загрузить вариант
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setUploadMode("approve");
                fileRef.current?.click();
              }}
            >
              Загрузить и утвердить
            </Button>
            <Link
              href={`/shots/${shotId}/${stageId}`}
              className="inline-flex h-8 items-center justify-center rounded-lg bg-secondary px-2.5 text-sm font-medium text-secondary-foreground"
            >
              Редактировать
            </Link>
            {stageId === "video_preview" || stageId === "final_render" ? (
              <label className="grid gap-1 text-xs text-stone-600">
                Воркфлоу
                <select
                  value={videoWorkflow}
                  onChange={(event) => setVideoWorkflow(event.target.value === "flf" ? "flf" : "i2v")}
                  className="h-9 rounded-lg border border-stone-300 bg-white px-2 text-sm text-stone-900"
                >
                  <option value="i2v">Wan i2v — из первого кадра</option>
                  <option value="flf">Wan FLF — первый и последний кадр</option>
                </select>
              </label>
            ) : null}
            {stage.busy ? (
              <>
                <p className="text-sm text-sky-900">
                  {STATUS_LABELS[stage.status]}. Запуск и отправка агенту закрыты до конца операции.
                </p>
                <Button variant="destructive" disabled={busy} onClick={cancelAction}>
                  Отменить
                </Button>
              </>
            ) : (
              <Button disabled={busy} onClick={runAction}>
                Запустить
              </Button>
            )}
            {stage.status === "error" ? (
              <Button variant="outline" disabled={busy} onClick={cancelAction}>
                Сбросить ошибку
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={busy}
              onClick={approveFirstOutput}
            >
              Утвердить
            </Button>
          </div>

          {message ? (
            <p className="text-sm text-stone-600">{message}</p>
          ) : null}

          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="image/*,video/*"
            onChange={(event) => onFileSelected(event.target.files?.[0] || null)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatSince(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
