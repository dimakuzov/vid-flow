"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { StageId } from "@/lib/series/constants";
import type { MediaFile, StageDetail } from "@/lib/series/types";
import { StatusPill } from "@/components/board/status-pill";

function DocFieldLabel({
  children,
  optional,
  note,
}: {
  children: ReactNode;
  optional?: boolean;
  note?: string;
}) {
  const hint = [note, optional ? "необязательно" : ""].filter(Boolean).join(" · ");
  return (
    <label className="flex flex-wrap items-baseline gap-x-2 text-xs font-medium text-stone-600">
      <span>{children}</span>
      {hint ? <span className="font-normal text-stone-400">{hint}</span> : null}
    </label>
  );
}

function MediaCard({
  file,
  selected,
  onSelect,
}: {
  file: MediaFile;
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-2 text-left transition ${
        selected
          ? "border-teal-700 bg-teal-50"
          : "border-stone-200 bg-white hover:border-stone-400"
      }`}
    >
      {file.kind === "image" ? (
        <Image
          src={file.url}
          alt={file.name}
          width={640}
          height={360}
          unoptimized
          className="aspect-video w-full rounded-lg object-cover"
        />
      ) : file.kind === "video" ? (
        <video
          src={file.url}
          className="aspect-video w-full rounded-lg bg-black object-contain"
          controls
          preload="metadata"
        />
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-lg bg-stone-100 text-sm text-stone-500">
          {file.name}
        </div>
      )}
      <div className="mt-2 truncate text-xs text-stone-600">{file.name}</div>
    </button>
  );
}

export function StageWorkspace({
  shotId,
  stageId,
  initialDetail,
}: {
  shotId: string;
  stageId: StageId;
  initialDetail: StageDetail;
}) {
  const [detail, setDetail] = useState<StageDetail>(initialDetail);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedOutput, setSelectedOutput] = useState<string[]>([]);
  const [docs, setDocs] = useState({
    prompt: initialDetail.docs.prompt || "",
    llmNotes: initialDetail.docs.llmNotes || "",
    refs: initialDetail.docs.refs || "",
    workflow: initialDetail.docs.workflow || "",
  });

  const reload = useCallback(async () => {
    setError("");
    const res = await fetch(`/api/shots/${shotId}/stages/${stageId}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Не удалось открыть этап");
      return;
    }
    setDetail(data);
    setDocs({
      prompt: data.docs.prompt || "",
      llmNotes: data.docs.llmNotes || "",
      refs: data.docs.refs || "",
      workflow: data.docs.workflow || "",
    });
  }, [shotId, stageId]);

  useEffect(() => {
    setDetail(initialDetail);
    setDocs({
      prompt: initialDetail.docs.prompt || "",
      llmNotes: initialDetail.docs.llmNotes || "",
      refs: initialDetail.docs.refs || "",
      workflow: initialDetail.docs.workflow || "",
    });
  }, [initialDetail]);

  async function saveDocs() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/shots/${shotId}/stages/${stageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(docs),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не сохранено");
      setDetail(data);
      setMessage("Документы этапа сохранены");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function upload(target: "refs" | "output", approveAfter = false) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      setMessage("");
      try {
        const form = new FormData();
        form.set("file", file);
        form.set("target", target);
        form.set("approveAfter", approveAfter ? "true" : "false");
        const res = await fetch(`/api/shots/${shotId}/stages/${stageId}/upload`, {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
        setMessage(`Файл сохранён в проект: ${data.savedAs}`);
        await reload();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Ошибка");
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }

  async function approveSelected() {
    if (!selectedOutput.length) {
      setMessage("Выберите файлы в output");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/shots/${shotId}/stages/${stageId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filenames: selectedOutput, from: "output" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не утверждено");
      setMessage(`Утверждено: ${data.approved.join(", ")}`);
      setSelectedOutput([]);
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function runStage() {
    setBusy(true);
    try {
      const res = await fetch(`/api/shots/${shotId}/stages/${stageId}/run`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не запущено");
      setMessage(data.message);
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  function toggleOutput(name: string) {
    setSelectedOutput((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name],
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-red-700">{error}</p>
        <Link href="/" className="mt-4 inline-block text-teal-800 underline">
          Назад к таблице
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-teal-800 hover:underline">
            ← Таблица
          </Link>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl text-stone-950">
            {detail.shotId} · {detail.stageLabel}
          </h1>
          <p className="mt-1 text-sm text-stone-600">{detail.shotTitle}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill status={detail.status} />
            <code className="rounded bg-stone-100 px-2 py-1 text-xs text-stone-600">
              {detail.relativeDir}
            </code>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => upload("refs")}>
            Загрузить ref
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => upload("output")}>
            Загрузить output
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => upload("output", true)}
          >
            Загрузить и утвердить
          </Button>
          <Button disabled={busy} onClick={runStage}>
            Запустить
          </Button>
          <Button variant="secondary" disabled={busy} onClick={approveSelected}>
            Утвердить выбранные
          </Button>
        </div>
      </div>

      {message ? <p className="text-sm text-stone-600">{message}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-stone-200 bg-white/90 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
            Input
          </h2>
          <div className="mt-4 space-y-3">
            <DocFieldLabel>Prompt</DocFieldLabel>
            <Textarea
              value={docs.prompt}
              onChange={(e) => setDocs((d) => ({ ...d, prompt: e.target.value }))}
              className="min-h-28"
            />
            <DocFieldLabel optional>Рекомендация LLM</DocFieldLabel>
            <Textarea
              value={docs.llmNotes}
              onChange={(e) => setDocs((d) => ({ ...d, llmNotes: e.target.value }))}
              className="min-h-24"
            />
            <DocFieldLabel optional note="заметка">
              Refs.md
            </DocFieldLabel>
            <Textarea
              value={docs.refs}
              onChange={(e) => setDocs((d) => ({ ...d, refs: e.target.value }))}
              className="min-h-24 font-mono text-xs"
            />
            <DocFieldLabel optional note="заметка на этот кадр">
              Workflow.md
            </DocFieldLabel>
            <Textarea
              value={docs.workflow}
              onChange={(e) => setDocs((d) => ({ ...d, workflow: e.target.value }))}
              className="min-h-24 font-mono text-xs"
            />
            <Button disabled={busy} onClick={saveDocs}>
              Сохранить документы
            </Button>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-medium text-stone-800">Файлы refs/</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {detail.refs.length ? (
                detail.refs.map((file) => <MediaCard key={file.relativePath} file={file} />)
              ) : (
                <p className="text-sm text-stone-500">Пока пусто</p>
              )}
            </div>
          </div>

          {detail.playbooks.length ? (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-stone-800">Playbooks</h3>
              <ul className="mt-2 space-y-1 text-xs text-stone-600">
                {detail.playbooks.map((item) => (
                  <li key={item}>
                    <code>{item}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-6 text-xs text-stone-500">
              Глобальные playbooks пока не добавлены — положишь их в /playbooks, и
              они появятся здесь.
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white/90 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
            Output
          </h2>
          <div className="mt-4">
            <h3 className="text-sm font-medium text-stone-800">approve/</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {detail.approve.length ? (
                detail.approve.map((file) => (
                  <MediaCard key={file.relativePath} file={file} />
                ))
              ) : (
                <p className="text-sm text-stone-500">Ещё ничего не утверждено</p>
              )}
            </div>
          </div>
          <div className="mt-6">
            <h3 className="text-sm font-medium text-stone-800">output/</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {detail.output.length ? (
                detail.output.map((file) => (
                  <MediaCard
                    key={file.relativePath}
                    file={file}
                    selected={selectedOutput.includes(file.name)}
                    onSelect={() => toggleOutput(file.name)}
                  />
                ))
              ) : (
                <p className="text-sm text-stone-500">Вариантов пока нет</p>
              )}
            </div>
          </div>
          {detail.stageId === "characters" ? (
            <p className="mt-4 text-xs text-stone-500">
              Для персонажей в approve может быть несколько файлов. Имена:{" "}
              <code>{"{character}_" + detail.shotId + ".png"}</code>
              {detail.expectedCharacters.length
                ? ` · ожидаются: ${detail.expectedCharacters.join(", ")}`
                : ""}
            </p>
          ) : (
            <p className="mt-4 text-xs text-stone-500">
              В approve для этого этапа хранится один выбранный файл.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
