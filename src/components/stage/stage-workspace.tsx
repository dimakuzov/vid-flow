"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { StageId } from "@/lib/series/constants";
import type { MediaFile, StageDetail } from "@/lib/series/types";
import { StatusPill } from "@/components/board/status-pill";

function subjectKey(filename: string, shotId: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  const shotSuffix = `_${shotId}`;
  if (base.endsWith(shotSuffix)) return base.slice(0, -shotSuffix.length);
  const cut = base.indexOf("_");
  return cut === -1 ? base : base.slice(0, cut);
}

function refRole(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  if (base.endsWith("_outfit")) return "образ";
  if (base.endsWith("_pose")) return "поза";
  if (base.endsWith("_face")) return "лицо";
  return "файл";
}

function usedRefNames(
  refs: MediaFile[],
  output: MediaFile[],
  selectedOutput: string[],
  shotId: string,
): string[] {
  const picked = selectedOutput.length
    ? output.filter((file) => selectedOutput.includes(file.name))
    : output;
  const subjects = new Set(picked.map((file) => subjectKey(file.name, shotId)));
  return refs
    .filter((file) => subjects.has(subjectKey(file.name, shotId)))
    .map((file) => file.name);
}

function RefFiles({
  files,
  selectedName,
  usedNames,
  onSelect,
  onOpen,
}: {
  files: MediaFile[];
  selectedName: string | null;
  usedNames: string[];
  onSelect: (name: string) => void;
  onOpen: (file: MediaFile) => void;
}) {
  const selected = files.find((file) => file.name === selectedName) ?? null;
  const used = new Set(usedNames);

  if (!files.length) {
    return <p className="text-sm text-stone-500">В refs/ пока нет файлов.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-stone-500">
        {selected
          ? `${refRole(selected.name)} · ${selected.name}. Картинка открывается на весь экран.`
          : usedNames.length
            ? `Использованы: ${usedNames.join(", ")}.`
            : "Имя под картинкой выделяет файл. Сама картинка открывается на весь экран."}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {files.map((file) => (
          <MediaCard
            key={file.relativePath}
            file={file}
            selected={file.name === selectedName}
            onSelect={() => onSelect(file.name)}
            onOpen={() => onOpen(file)}
            caption={`${refRole(file.name)}${used.has(file.name) ? " · использован" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

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

function ImageLightbox({
  files,
  index,
  onClose,
  onIndex,
}: {
  files: MediaFile[];
  index: number;
  onClose: () => void;
  onIndex: (next: number) => void;
}) {
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

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      onClick={onClose}
    >
      <img
        src={file.url}
        alt={file.name}
        className="max-h-full max-w-full object-contain"
        onClick={(event) => event.stopPropagation()}
      />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-black/60 px-4 py-3 text-sm text-white">
        <span className="truncate">{file.name}</span>
        <span className="shrink-0 text-white/70">
          {index + 1} / {files.length}
        </span>
      </div>
      <button
        type="button"
        className="absolute top-4 right-4 rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white"
        onClick={onClose}
      >
        Закрыть
      </button>
    </div>
  );
}

function MediaCard({
  file,
  selected,
  onSelect,
  onOpen,
  onRemove,
  caption,
  onApprove,
}: {
  file: MediaFile;
  selected?: boolean;
  onSelect?: () => void;
  onOpen?: () => void;
  onRemove?: () => void;
  caption?: string;
  onApprove?: () => void;
}) {
  return (
    <div
      className={`w-full rounded-xl border p-2 text-left ${
        selected ? "border-teal-700 bg-teal-50" : "border-stone-200 bg-white"
      }`}
    >
      {file.kind === "image" ? (
        <button
          type="button"
          onClick={onOpen}
          className="block w-full cursor-zoom-in"
          aria-label={`Открыть ${file.name} на весь экран`}
        >
          <Image
            src={file.url}
            alt={file.name}
            width={640}
            height={960}
            unoptimized
            className="max-h-96 w-full rounded-lg bg-stone-100 object-contain"
          />
        </button>
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
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          className="mt-2 w-full truncate text-left text-xs text-stone-600"
        >
          {selected ? "Выбрано · " : ""}
          {caption ? `${caption} · ` : ""}
          {file.name}
        </button>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-stone-600">
          <span className="truncate">
            {caption ? `${caption} · ` : ""}
            {file.name}
          </span>
          {onRemove ? (
            <button type="button" onClick={onRemove} className="shrink-0 text-stone-500 underline">
              Убрать
            </button>
          ) : null}
        </div>
      )}
      {onApprove ? (
        <button
          type="button"
          onClick={onApprove}
          className="mt-2 rounded-lg bg-teal-800 px-2 py-1 text-xs text-white"
        >
          Утвердить этот вариант
        </button>
      ) : null}
    </div>
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
  const [seenDetail, setSeenDetail] = useState(initialDetail);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedOutput, setSelectedOutput] = useState<string[]>([]);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ files: MediaFile[]; index: number } | null>(null);
  const [docs, setDocs] = useState({
    prompt: initialDetail.docs.prompt || "",
    llmNotes: initialDetail.docs.llmNotes || "",
    refs: initialDetail.docs.refs || "",
    workflow: initialDetail.docs.workflow || "",
  });

  function openImage(files: MediaFile[], file: MediaFile) {
    const images = files.filter((item) => item.kind === "image");
    const index = images.findIndex((item) => item.relativePath === file.relativePath);
    if (index >= 0) setViewer({ files: images, index });
  }

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

  if (seenDetail !== initialDetail) {
    setSeenDetail(initialDetail);
    setDetail(initialDetail);
    setDocs({
      prompt: initialDetail.docs.prompt || "",
      llmNotes: initialDetail.docs.llmNotes || "",
      refs: initialDetail.docs.refs || "",
      workflow: initialDetail.docs.workflow || "",
    });
  }

  async function sendToAgent() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/shots/${shotId}/stages/${stageId}/agent-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: docs.llmNotes,
          prompt: docs.prompt,
          refs: docs.refs,
          workflow: docs.workflow,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не отправлено");
      setDetail(data.stage);
      setDocs({
        prompt: data.stage.docs.prompt || "",
        llmNotes: data.stage.docs.llmNotes || "",
        refs: data.stage.docs.refs || "",
        workflow: data.stage.docs.workflow || "",
      });
      setMessage(data.message);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  function applyDetail(data: StageDetail) {
    setDetail(data);
    setDocs({
      prompt: data.docs.prompt || "",
      llmNotes: data.docs.llmNotes || "",
      refs: data.docs.refs || "",
      workflow: data.docs.workflow || "",
    });
  }

  async function restorePrompt(versionId: string) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/shots/${shotId}/stages/${stageId}/prompt-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось вернуть промпт");
      applyDetail(data);
      setMessage("Промпт возвращён. Текущий текст сохранён в списке версий.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

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

  async function removeApproved(filename: string) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/shots/${shotId}/stages/${stageId}/approve`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось убрать");
      setMessage(`${filename} убран из approve`);
      if (data.stage) setDetail(data.stage);
      else await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function approveSelected(names = selectedOutput) {
    if (!names.length) {
      setMessage("Выберите файлы в output");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/shots/${shotId}/stages/${stageId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filenames: names, from: "output" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не утверждено");
      const approved = data.approved.join(", ");
      setMessage(
        stageId === "characters" && data.stage?.status !== "approved"
          ? `В approve: ${approved}. Этап станет утверждённым, когда файл будет у каждого персонажа.`
          : `Утверждено: ${approved}`,
      );
      setSelectedOutput([]);
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function setWatch(stopped: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/shots/${shotId}/watch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stopped }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось закрыть кадр");
      setDetail((current) => ({ ...current, watch: data }));
      setMessage(
        data.videoDone
          ? "У кадра уже есть утверждённое видео. Агент его не берёт."
          : stopped
            ? "Кадр закрыт. Агент больше не принимает рекомендации по нему."
            : "Агент снова смотрит этот кадр.",
      );
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
          <Button
            variant="outline"
            disabled={busy || detail.watch.videoDone}
            onClick={() => setWatch(!detail.watch.stopped)}
          >
            {detail.watch.videoDone
              ? "Видео готово"
              : detail.watch.stopped
                ? "Снова следить"
                : "Закончить кадр"}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => approveSelected()}>
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
            {detail.promptHistory.length ? (
              <ul className="space-y-2">
                {detail.promptHistory.map((version) => (
                  <li
                    key={version.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] text-stone-400">
                        {version.savedAt.slice(0, 16).replace("T", " ")}
                      </div>
                      <div className="truncate text-xs text-stone-600">
                        {version.prompt.trim().split("\n")[0] || "(пустой промпт)"}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => restorePrompt(version.id)}
                    >
                      Вернуть
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-stone-500">
                Это текущий промпт. Следующая сохранённая правка оставит его в списке, и его
                можно будет вернуть.
              </p>
            )}
            <DocFieldLabel note="только новая правка">
              Рекомендация
            </DocFieldLabel>
            <Textarea
              value={docs.llmNotes}
              onChange={(e) => setDocs((d) => ({ ...d, llmNotes: e.target.value }))}
              className="min-h-24"
              placeholder="Что изменить в текущем промпте."
            />
            {detail.docs.runLog.trim() ? (
              <details className="text-xs text-stone-500">
                <summary className="cursor-pointer">Журнал прогона</summary>
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
                  {detail.docs.runLog}
                </pre>
              </details>
            ) : null}
            <DocFieldLabel note="файлы из refs/">Референсы</DocFieldLabel>
            <RefFiles
              files={detail.refs}
              selectedName={selectedRef}
              usedNames={usedRefNames(detail.refs, detail.output, selectedOutput, shotId)}
              onSelect={(name) => setSelectedRef((current) => (current === name ? null : name))}
              onOpen={(file) => openImage(detail.refs, file)}
            />
            <details className="text-xs text-stone-500">
              <summary className="cursor-pointer">Заметка refs.md</summary>
              <Textarea
                value={docs.refs}
                onChange={(e) => setDocs((d) => ({ ...d, refs: e.target.value }))}
                className="mt-2 min-h-24 font-mono text-xs"
              />
            </details>
            <DocFieldLabel optional note="заметка на этот кадр">
              Workflow.md
            </DocFieldLabel>
            <Textarea
              value={docs.workflow}
              onChange={(e) => setDocs((d) => ({ ...d, workflow: e.target.value }))}
              className="min-h-24 font-mono text-xs"
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={saveDocs}>
                Сохранить документы
              </Button>
              <Button variant="secondary" disabled={busy} onClick={sendToAgent}>
                Отправить агенту
              </Button>
            </div>
            <p className="text-xs leading-5 text-stone-500">
              «Отправить агенту» пишет llm_task.md в папку этапа. Фразу из ответа вставь
              в Claude, Cursor или локальный Gemini. «Закончить кадр» останавливает
              проверку входящих. Она также останавливается, когда в final_render есть
              утверждённое видео.
            </p>
            {detail.agentRequest?.status === "pending" ? (
              <p className="text-xs leading-5 text-stone-500">
                Ждёт агента с {detail.agentRequest.createdAt}.{" "}
                {detail.agentRequest.refsChangedByUser
                  ? "Референсы менялись вручную."
                  : "Референсы вручную не менялись."}
              </p>
            ) : null}
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
                  <MediaCard
                    key={file.relativePath}
                    file={file}
                    onOpen={() => openImage(detail.approve, file)}
                    onRemove={busy ? undefined : () => removeApproved(file.name)}
                  />
                ))
              ) : (
                <p className="text-sm text-stone-500">Ещё ничего не утверждено</p>
              )}
            </div>
          </div>
          <div className="mt-6">
            <h3 className="text-sm font-medium text-stone-800">output/</h3>
            <p className="mt-1 text-xs text-stone-500">
              Имя файла выделяет вариант. Слева остаются референсы этого персонажа.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {detail.output.length ? (
                detail.output.map((file) => (
                  <MediaCard
                    key={file.relativePath}
                    file={file}
                    selected={selectedOutput.includes(file.name)}
                    onSelect={() => toggleOutput(file.name)}
                    onOpen={() => openImage(detail.output, file)}
                    onApprove={() => approveSelected([file.name])}
                  />
                ))
              ) : (
                <p className="text-sm text-stone-500">Вариантов пока нет</p>
              )}
            </div>
          </div>
          {detail.stageId === "characters" ? (
            <p className="mt-4 text-xs text-stone-500">
              Отметьте имя файла в output и нажмите «Утвердить выбранные». Для персонажа файл
              встанет как{" "}
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
      {viewer ? (
        <ImageLightbox
          files={viewer.files}
          index={viewer.index}
          onClose={() => setViewer(null)}
          onIndex={(index) => setViewer((current) => (current ? { ...current, index } : current))}
        />
      ) : null}
    </div>
  );
}
