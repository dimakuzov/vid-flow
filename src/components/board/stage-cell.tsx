"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLang, useT } from "@/components/language";
import { errorText, requestJson, stageApiPath, stagePagePath } from "@/components/stage/api";
import { ImageLightbox } from "@/components/stage/image-lightbox";
import { SuggestedWorkflow, WorkflowMenu } from "@/components/stage/workflow-menu";
import { clockLocale, statusName } from "@/lib/i18n";
import type { StageId } from "@/lib/series/constants";
import type { MediaFile, StageDetail, StageSummary } from "@/lib/series/types";
import { StatusPill } from "./status-pill";

/** Самый новый файл: `?v=` в url — mtime файла. */
function newestIndex(files: MediaFile[]): number {
  const version = (file: MediaFile) => Number(new URL(file.url, "http://x").searchParams.get("v")) || 0;
  return files.reduce((best, file, index) => (version(file) > version(files[best]) ? index : best), 0);
}

interface StageCellProps {
  episodeId: string;
  shotId: string;
  stageId: StageId;
  stage: StageSummary;
  onChanged: () => void;
}

export function StageCell({ episodeId, shotId, stageId, stage, onChanged }: StageCellProps) {
  const lang = useLang();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadMode, setUploadMode] = useState<"output" | "approve">("output");
  // В StageSummary нет вариантов воркфлоу: этап читается при открытии меню.
  const [detail, setDetail] = useState<StageDetail | null>(null);
  const [viewer, setViewer] = useState<{ files: MediaFile[]; index: number } | null>(null);
  const router = useRouter();
  const stageApi = stageApiPath(episodeId, shotId, stageId);
  const pagePath = stagePagePath(episodeId, shotId, stageId);

  /** Левая кнопка: «На проверке» — сразу новый вариант на весь экран, иначе страница этапа. */
  async function openCell() {
    if (stage.status !== "review") {
      router.push(pagePath);
      return;
    }
    try {
      const data = await requestJson<StageDetail>(stageApi);
      const files = data.output.filter((file) => file.kind === "image" || file.kind === "video");
      if (!files.length) throw new Error(t("cell.emptyOutput"));
      setDetail(data);
      setViewer({ files, index: newestIndex(files) });
    } catch {
      router.push(pagePath);
    }
  }

  const closeViewer = useCallback(() => setViewer(null), []);
  const moveViewer = useCallback(
    (index: number) => setViewer((current) => (current ? { ...current, index } : current)),
    [],
  );

  async function approveViewed(file: MediaFile) {
    setBusy(true);
    try {
      await requestJson(`${stageApi}/approve`, {
        method: "POST",
        body: { filenames: [file.name], from: "output" },
        fallbackError: t("cell.approveFailed"),
      });
      setViewer(null);
      onChanged();
    } catch (error) {
      window.alert(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function openMenu(next: boolean) {
    setOpen(next);
    if (!next) return;
    setMessage("");
    requestJson<StageDetail>(stageApi)
      .then(setDetail)
      .catch((error) => setMessage(errorText(error)));
  }

  async function chooseWorkflow(workflowId: string) {
    setBusy(true);
    setMessage("");
    try {
      setDetail(
        await requestJson<StageDetail>(stageApi, {
          method: "PATCH",
          body: { runWorkflow: workflowId },
          fallbackError: t("cell.workflowFailed"),
        }),
      );
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function chooseDuration(seconds: string) {
    setBusy(true);
    setMessage("");
    try {
      setDetail(
        await requestJson<StageDetail>(stageApi, {
          method: "PATCH",
          body: { runDuration: seconds },
          fallbackError: t("cell.durationFailed"),
        }),
      );
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function runAction() {
    setBusy(true);
    setMessage("");
    try {
      const data = await requestJson<{ message?: string; stage?: StageDetail }>(`${stageApi}/run`, {
        method: "POST",
        body: detail?.workflow ? { runWorkflow: detail.workflow } : {},
        fallbackError: t("cell.runFailed"),
      });
      if (data.stage) setDetail(data.stage);
      setMessage(data.message || t("cell.started"));
      onChanged();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function cancelAction() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`${stageApi}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("cell.cancelFailed"));
      setMessage(data.message || t("cell.cancelled"));
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("common.error"));
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
      const res = await fetch(`${stageApi}/upload`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("cell.uploadFailed"));
      setMessage(
        uploadMode === "approve"
          ? t("cell.uploadedApproved", { name: data.approvedAs || data.savedAs })
          : t("cell.uploaded", { name: data.savedAs }),
      );
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("common.error"));
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
      setMessage(stage.outputCount ? t("cell.pickInEdit") : t("cell.nothingToApprove"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${stageApi}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filenames, from: "output" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("cell.approveFailed"));
      const approved = data.approved?.join(", ");
      setMessage(
        stageId === "characters" && data.stage?.status !== "approved"
          ? t("cell.approvedPartial", { names: approved })
          : t("cell.approved", { names: approved }),
      );
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        title={t("cell.hint")}
        onClick={() => void openCell()}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu(true);
        }}
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
          <p className="text-[11px] text-sky-900" suppressHydrationWarning>{t("cell.since", { time: formatSince(stage.phaseSince, lang) })}</p>
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
                ? t("cell.outputCount", { n: stage.outputCount })
                : statusName(t, stage.status)}
            </span>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-stone-500">
            {stage.status === "empty" ? t("cell.noMedia") : statusName(t, stage.status)}
          </p>
        )}
      </button>

      <Dialog open={open} onOpenChange={openMenu}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("cell.action", { shot: shotId })}
            </DialogTitle>
            <DialogDescription>{t("cell.actionLead")}</DialogDescription>
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
              {t("cell.upload")}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setUploadMode("approve");
                fileRef.current?.click();
              }}
            >
              {t("cell.uploadApprove")}
            </Button>
            <Link
              href={stagePagePath(episodeId, shotId, stageId)}
              className="inline-flex h-8 items-center justify-center rounded-lg bg-secondary px-2.5 text-sm font-medium text-secondary-foreground"
            >
              {t("cell.edit")}
            </Link>
            {detail?.workflows.length ? (
              <>
                <WorkflowMenu
                  id={`cell-workflow-${shotId}-${stageId}`}
                  workflows={detail.workflows}
                  selected={detail.workflow}
                  disabled={busy || stage.busy}
                  onSelect={chooseWorkflow}
                  duration={{ range: detail.durationRange, selected: detail.durationSec }}
                  onDuration={chooseDuration}
                />
                <SuggestedWorkflow
                  workflows={detail.workflows}
                  selected={detail.workflow}
                  suggested={detail.agentRequest?.suggestedWorkflow}
                  disabled={busy || stage.busy}
                  onSwitch={chooseWorkflow}
                />
              </>
            ) : null}
            {stage.busy ? (
              <>
                <p className="text-sm text-sky-900">
                  {t("cell.busy", { status: statusName(t, stage.status) })}
                </p>
                <Button variant="destructive" disabled={busy} onClick={cancelAction}>
                  {t("cell.cancel")}
                </Button>
              </>
            ) : detail && !detail.workflows.length ? (
              <p className="text-xs text-stone-500">
                {t("cell.agentOnly")}
              </p>
            ) : (
              <Button disabled={busy || !detail} onClick={runAction}>
                {t("cell.run")}
              </Button>
            )}
            {stage.status === "error" ? (
              <Button variant="outline" disabled={busy} onClick={cancelAction}>
                {t("cell.reset")}
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={busy}
              onClick={approveFirstOutput}
            >
              {t("cell.approve")}
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

      {viewer ? (
        <ImageLightbox
          files={viewer.files}
          index={viewer.index}
          onClose={closeViewer}
          onIndex={moveViewer}
          showRunContext
          actions={(file) => (
            <>
              <button
                type="button"
                disabled={busy || detail?.state.busy}
                onClick={() => void approveViewed(file)}
                className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {t("cell.approve")}
              </button>
              <Link href={pagePath} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white">
                {t("cell.edit")}
              </Link>
            </>
          )}
        />
      ) : null}
    </>
  );
}

function formatSince(iso: string, lang: "en" | "ru"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(clockLocale(lang), { hour: "2-digit", minute: "2-digit" });
}
