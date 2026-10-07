"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { StatusPill } from "@/components/board/status-pill";
import { Button } from "@/components/ui/button";
import type { MediaFile, StageDetail } from "@/lib/series/types";
import { AgentPanel } from "./agent-panel";
import { useAgentProviders } from "./agent-provider";
import { episodePagePath, errorText, requestJson, shotApiPath } from "./api";
import { DocFieldLabel, DocTextarea } from "./doc-field";
import { ImageLightbox } from "./image-lightbox";
import { OutputPanel } from "./output-panel";
import { PromptHistory } from "./prompt-history";
import { RefFiles, usedRefNames } from "./ref-files";
import { StageInputs } from "./stage-inputs";
import { StageStatusBar } from "./stage-status-bar";
import { useStageDetail, type DocField } from "./use-stage-detail";
import { SuggestedWorkflow, WorkflowMenu } from "./workflow-menu";

const PROMPT_PLACEHOLDER = "Текст для модели, на английском. Пусто — отправьте рекомендацию агенту.";

type Viewer = { files: MediaFile[]; index: number; runContext: boolean };

export function StageWorkspace({ initialDetail }: { initialDetail: StageDetail }) {
  const stage = useStageDetail(initialDetail);
  const { detail, fields, docs, stageApi } = stage;
  const { episodeId, shotId, stageId } = detail;
  const shotApi = shotApiPath(episodeId, shotId);

  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedOutput, setSelectedOutput] = useState<string[]>([]);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);

  const agentMode = detail.workflows.some((item) => item.available) ? "text" : "agent";
  const agent = useAgentProviders(agentMode);
  const stageBusy = detail.state.busy;
  const canRun = detail.workflows.length > 0;

  /** Действие кнопки: блокирует кнопки, показывает результат или ошибку. */
  async function act(work: () => Promise<string | void>) {
    setBusy(true);
    setMessage("");
    try {
      const text = await work();
      if (text) setMessage(text);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function openImage(files: MediaFile[], file: MediaFile, runContext: boolean) {
    const images = files.filter((item) => item.kind === "image");
    const index = images.findIndex((item) => item.relativePath === file.relativePath);
    if (index >= 0) setViewer({ files: images, index, runContext });
  }

  const closeViewer = useCallback(() => setViewer(null), []);
  const moveViewer = useCallback(
    (index: number) => setViewer((current) => (current ? { ...current, index } : current)),
    [],
  );

  /** Сохранить поля на диск. В модель идёт prompt.md с диска, поэтому перед запуском — тоже. */
  async function saveDocs(): Promise<StageDetail> {
    const saved = await requestJson<StageDetail>(stageApi, {
      method: "PATCH",
      body: docs,
      fallbackError: "Не удалось сохранить",
    });
    stage.reset(saved);
    return saved;
  }

  const sendToAgent = () =>
    act(async () => {
      const data = await requestJson<{ message: string; stage: StageDetail }>(
        `${stageApi}/agent-request`,
        {
          method: "POST",
          body: {
            message: docs.llmNotes,
            prompt: docs.prompt,
            refs: docs.refs,
            workflow: docs.workflow,
            ...(detail.workflow ? { runWorkflow: detail.workflow } : {}),
            ...(agent.selected ? { provider: agent.selected } : {}),
            ...(agent.model ? { model: agent.model } : {}),
          },
          fallbackError: "Не отправлено",
        },
      );
      stage.reset(data.stage);
      return data.message;
    });

  const runStage = () =>
    act(async () => {
      await saveDocs();
      const data = await requestJson<{ message: string; stage?: StageDetail }>(`${stageApi}/run`, {
        method: "POST",
        body: detail.workflow ? { runWorkflow: detail.workflow } : {},
        fallbackError: "Не запущено",
      });
      if (data.stage) stage.merge(data.stage);
      else await stage.reload();
      return data.message;
    });

  const chooseWorkflow = (workflowId: string) =>
    act(async () => {
      const data = await requestJson<StageDetail>(stageApi, {
        method: "PATCH",
        body: { runWorkflow: workflowId },
        fallbackError: "Не удалось выбрать воркфлоу",
      });
      stage.merge(data);
    });

  const cancelStage = () =>
    act(async () => {
      const data = await requestJson<{ message: string; stage?: StageDetail }>(
        `${stageApi}/cancel`,
        { method: "POST", fallbackError: "Не удалось отменить" },
      );
      if (data.stage) stage.merge(data.stage);
      return data.message;
    });

  const restorePrompt = (versionId: string) =>
    act(async () => {
      const data = await requestJson<StageDetail>(`${stageApi}/prompt-history`, {
        method: "POST",
        body: { versionId },
        fallbackError: "Не удалось вернуть промпт",
      });
      stage.reset(data);
      return "Промпт возвращён. Текущий текст сохранён в списке версий.";
    });

  function upload(target: "refs" | "output", approveAfter = false) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void act(async () => {
        const form = new FormData();
        form.set("file", file);
        form.set("target", target);
        form.set("approveAfter", approveAfter ? "true" : "false");
        const res = await fetch(`${stageApi}/upload`, { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
        await stage.reload();
        return `Файл сохранён в проект: ${data.savedAs}`;
      });
    };
    input.click();
  }

  const removeApproved = (filename: string) =>
    act(async () => {
      const data = await requestJson<{ stage?: StageDetail }>(`${stageApi}/approve`, {
        method: "DELETE",
        body: { filename },
        fallbackError: "Не удалось убрать",
      });
      if (data.stage) stage.merge(data.stage);
      else await stage.reload();
      return `${filename} убран из approve`;
    });

  /** Удалить файл с диска насовсем, после подтверждения. Ответ маршрута — StageDetail. */
  const deleteFile = (folder: "output" | "refs", filename: string) => {
    if (!window.confirm(`Удалить файл ${filename} навсегда?`)) return;
    void act(async () => {
      const data = await requestJson<StageDetail>(`${stageApi}/files`, {
        method: "DELETE",
        body: { folder, filename },
        fallbackError: "Не удалось удалить файл",
      });
      stage.merge(data);
      if (folder === "output") setSelectedOutput((prev) => prev.filter((item) => item !== filename));
      else setSelectedRef((current) => (current === filename ? null : current));
      return `${filename} удалён из ${folder}/`;
    });
  };
  const deleteRef = stageBusy ? undefined : (name: string) => deleteFile("refs", name);

  const approveSelected = (names = selectedOutput) => {
    if (!names.length) {
      setMessage("Выберите файлы в output");
      return;
    }
    void act(async () => {
      const data = await requestJson<{ approved: string[]; stage?: StageDetail }>(
        `${stageApi}/approve`,
        { method: "POST", body: { filenames: names, from: "output" }, fallbackError: "Не утверждено" },
      );
      setSelectedOutput([]);
      await stage.reload();
      const approved = data.approved.join(", ");
      return stageId === "characters" && data.stage?.status !== "approved"
        ? `В approve: ${approved}. Этап станет утверждённым, когда файл будет у каждого персонажа.`
        : `Утверждено: ${approved}`;
    });
  };

  const setWatch = (stopped: boolean) =>
    act(async () => {
      const data = await requestJson<StageDetail["watch"]>(`${shotApi}/watch`, {
        method: "POST",
        body: { stopped },
        fallbackError: "Не удалось закрыть кадр",
      });
      await stage.reload();
      return data.videoDone
        ? "У кадра уже есть утверждённое видео. Агент его не берёт."
        : stopped
          ? "Кадр закрыт. Агент больше не принимает рекомендации по нему."
          : "Агент снова смотрит этот кадр.";
    });

  function toggleOutput(name: string) {
    setSelectedOutput((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name],
    );
  }

  function docField(field: DocField, options: { readOnly?: boolean; placeholder?: string; className?: string }) {
    return (
      <DocTextarea
        id={`doc-${field}`}
        field={fields[field]}
        disk={detail.docs[field] || ""}
        onChange={(value) => stage.edit(field, value)}
        onPull={() => stage.pull(field)}
        onKeep={() => stage.keep(field)}
        {...options}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={episodePagePath(episodeId)} className="text-sm text-teal-800 hover:underline">
            ← Таблица {episodeId}
          </Link>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl text-stone-950">
            {shotId} · {detail.stageLabel}
          </h1>
          <p className="mt-1 text-sm text-stone-600">{detail.shotTitle}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill status={detail.status} />
            <code className="break-all rounded bg-stone-100 px-2 py-1 text-xs text-stone-600">
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
          <Button variant="outline" disabled={busy} onClick={() => upload("output", true)}>
            Загрузить и утвердить
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

      <StageStatusBar detail={detail} disabled={busy} onCancel={cancelStage} />

      {canRun ? (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white/90 px-4 py-3">
          <div className="w-full min-w-0 sm:w-auto sm:min-w-80 sm:flex-1">
            <WorkflowMenu
              id="run-workflow"
              workflows={detail.workflows}
              selected={detail.workflow}
              disabled={busy || stageBusy}
              onSelect={chooseWorkflow}
            />
          </div>
          {!stageBusy ? (
            <Button disabled={busy} onClick={runStage}>
              Запустить
            </Button>
          ) : null}
          <div className="w-full">
            <SuggestedWorkflow
              workflows={detail.workflows}
              selected={detail.workflow}
              suggested={detail.agentRequest?.suggestedWorkflow}
              disabled={busy || stageBusy}
              onSwitch={chooseWorkflow}
            />
          </div>
        </div>
      ) : null}

      {message ? <p className="text-sm text-stone-600">{message}</p> : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <section className="min-w-0 rounded-2xl border border-stone-200 bg-white/90 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
            Input
          </h2>
          <div className="mt-4 space-y-3">
            {detail.shotSummary.trim() ? (
              <div className="rounded-lg bg-stone-50 px-3 py-2">
                <div className="text-xs font-medium text-stone-600">Действие кадра</div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{detail.shotSummary}</p>
              </div>
            ) : null}
            <DocFieldLabel htmlFor="doc-prompt" note="этот текст уходит в модель">
              Prompt
            </DocFieldLabel>
            {docField("prompt", {
              readOnly: stageBusy,
              placeholder: PROMPT_PLACEHOLDER,
              className: "min-h-28",
            })}
            <PromptHistory
              versions={detail.promptHistory}
              disabled={busy}
              onRestore={restorePrompt}
            />
            <DocFieldLabel htmlFor="doc-llmNotes" note="для агента · очищается после отправки">
              Рекомендация
            </DocFieldLabel>
            {docField("llmNotes", {
              readOnly: stageBusy,
              placeholder: "Что изменить в текущем промпте.",
              className: "min-h-24",
            })}
            {detail.docs.runLog.trim() ? (
              <details className="text-xs text-stone-500">
                <summary className="cursor-pointer">Журнал прогона</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
                  {detail.docs.runLog}
                </pre>
              </details>
            ) : null}
            <StageInputs
              inputs={detail.inputs}
              boardRuns={canRun}
              onOpen={(files, file) => openImage(files, file, false)}
              onDeleteRef={busy ? undefined : deleteRef}
            />
            <DocFieldLabel note="файлы из refs/">Референсы</DocFieldLabel>
            <RefFiles
              files={detail.refs}
              selectedName={selectedRef}
              usedNames={usedRefNames(detail.refs, detail.output, selectedOutput, shotId)}
              onSelect={(name) => setSelectedRef((current) => (current === name ? null : name))}
              onOpen={(file) => openImage(detail.refs, file, false)}
              onDelete={busy ? undefined : deleteRef}
            />
            <details className="text-xs text-stone-500">
              <summary className="cursor-pointer">Заметка refs.md</summary>
              <div className="mt-2">
                {docField("refs", { className: "min-h-24 font-mono text-xs" })}
              </div>
            </details>
            <details className="text-xs text-stone-500">
              <summary className="cursor-pointer">Заметка workflow.md (на этот кадр)</summary>
              <div className="mt-2">
                {docField("workflow", { className: "min-h-24 font-mono text-xs" })}
              </div>
            </details>
            {stage.dirty ? (
              <Button variant="outline" disabled={busy} onClick={() => act(async () => {
                await saveDocs();
                return "Сохранено.";
              })}>
                Сохранить поля
              </Button>
            ) : null}
            <AgentPanel
              detail={detail}
              disabled={busy}
              mode={agentMode}
              providers={agent.providers}
              provider={agent.selected}
              onChooseProvider={agent.choose}
              model={agent.model}
              onChooseModel={agent.chooseModel}
              onSend={sendToAgent}
            />
          </div>

          {detail.playbooks.length ? (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-stone-800">Playbooks</h3>
              <ul className="mt-2 space-y-1 text-xs break-all text-stone-600">
                {detail.playbooks.map((item) => (
                  <li key={item}>
                    <code>{item}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-6 text-xs text-stone-500">
              Глобальные playbooks пока не добавлены — положишь их в /playbooks, и они появятся
              здесь.
            </p>
          )}
        </section>

        <OutputPanel
          detail={detail}
          disabled={busy}
          selectedOutput={selectedOutput}
          onToggle={toggleOutput}
          onOpen={(files, file) => openImage(files, file, true)}
          onApprove={approveSelected}
          onRemoveApproved={removeApproved}
          onDelete={(name) => deleteFile("output", name)}
        />
      </div>
      {viewer ? (
        <ImageLightbox
          files={viewer.files}
          index={viewer.index}
          onClose={closeViewer}
          onIndex={moveViewer}
          showRunContext={viewer.runContext}
        />
      ) : null}
    </div>
  );
}
