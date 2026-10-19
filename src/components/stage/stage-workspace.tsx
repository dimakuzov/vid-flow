"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusPill } from "@/components/board/status-pill";
import { isTypingTarget, overlayOpen } from "@/components/hotkeys";
import { LanguageSwitch, useT } from "@/components/language";
import { stageName } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import type { EditWorkflow } from "@/lib/comfy/edit";
import type { ImageEditRecord } from "@/lib/series/mutations";
import type { MediaFile, StageDetail } from "@/lib/series/types";
import { AgentPanel } from "./agent-panel";
import { CharacterRoster, characterOwnsFile } from "./character-roster";
import { useAgentProviders } from "./agent-provider";
import { episodePagePath, errorText, requestJson, shotApiPath } from "./api";
import { DocFieldLabel, DocTextarea } from "./doc-field";
import { HotkeyHelp } from "./hotkey-help";
import { ImageEditDialog } from "./image-edit-dialog";
import { ImageLightbox } from "./image-lightbox";
import { LocationChoice } from "./location-choice";
import { LocationLibrary } from "./location-library";
import { RefSourcePicker } from "./ref-source-picker";
import { OutputPanel } from "./output-panel";
import { PrevShotRefButton } from "./prev-shot-buttons";
import { PromptHistory } from "./prompt-history";
import { RefFiles, usedRefNames } from "./ref-files";
import { ShotContext } from "./shot-context";
import { StageInputs } from "./stage-inputs";
import { StageStatusBar } from "./stage-status-bar";
import { useStageDetail, type DocField } from "./use-stage-detail";
import { SuggestedWorkflow, WorkflowMenu } from "./workflow-menu";

type PictureFolder = "output" | "approve" | "refs";

type Viewer = { files: MediaFile[]; index: number; runContext: boolean; folder: PictureFolder };

export function StageWorkspace({ initialDetail }: { initialDetail: StageDetail }) {
  const t = useT();
  const stage = useStageDetail(initialDetail);
  const { detail, fields, docs, stageApi } = stage;
  const { episodeId, shotId, stageId } = detail;
  const shotApi = shotApiPath(episodeId, shotId);
  const router = useRouter();

  const [message, setMessage] = useState("");
  const [activeCharacter, setActiveCharacter] = useState<string | null>(
    initialDetail.stageId === "characters" ? initialDetail.expectedCharacters[0] ?? null : null,
  );
  const [busy, setBusy] = useState(false);
  const [selectedOutput, setSelectedOutput] = useState<string[]>([]);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [edits, setEdits] = useState<ImageEditRecord[]>([]);
  const [editWorkflows, setEditWorkflows] = useState<EditWorkflow[]>([]);
  const [editing, setEditing] = useState<{ file: MediaFile; folder: "output" | "approve" } | null>(null);

  const agentMode = detail.workflows.some((item) => item.available) ? "text" : "agent";
  const agent = useAgentProviders(agentMode, detail.shotAgent, stageId);
  // Кадр без агента получает того, кому отдали этап; у кадра с агентом другой выбор — только на этот раз.
  const [rememberChoice, setRememberChoice] = useState<boolean | null>(null);
  const rememberForShot = rememberChoice ?? !detail.shotAgent;
  const stageBusy = detail.state.busy;
  const characterNames = stageId === "characters" ? detail.expectedCharacters : [];
  const editingCharacter =
    characterNames.find((name) => name.toLowerCase() === activeCharacter?.toLowerCase()) ??
    characterNames[0] ??
    null;
  const canRun = detail.workflows.length > 0;
  // Выбранный (или по умолчанию) воркфлоу: облачный — только с галочкой, на один запуск.
  const activeWorkflow =
    detail.workflows.find((item) => item.id === detail.workflow) ??
    detail.workflows.find((item) => item.isDefault) ??
    null;
  const cloudCost = activeWorkflow?.cloud ?? null;
  const [allowCloud, setAllowCloud] = useState(false);
  // Число рендеров живёт только пока открыта эта страница. Новый заход в клетку — снова 1.
  const [takes, setTakes] = useState(1);
  useEffect(() => {
    setTakes(1);
  }, [episodeId, shotId, stageId]);

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

  function openImage(files: MediaFile[], file: MediaFile, runContext: boolean, folder: PictureFolder) {
    const images = files.filter((item) => item.kind === "image");
    const index = images.findIndex((item) => item.relativePath === file.relativePath);
    if (index >= 0) setViewer({ files: images, index, runContext, folder });
  }

  const loadEdits = useCallback(async () => {
    const data = await requestJson<{ edits: ImageEditRecord[]; workflows: EditWorkflow[] }>(`${stageApi}/edit`, {
      fallbackError: t("page.editsFailed"),
    });
    setEdits(data.edits);
    setEditWorkflows(data.workflows);
  }, [stageApi, t]);

  useEffect(() => {
    let stopped = false;
    requestJson<{ edits: ImageEditRecord[]; workflows: EditWorkflow[] }>(`${stageApi}/edit`, {
      fallbackError: t("page.editsFailed"),
    })
      .then((data) => {
        if (stopped) return;
        setEdits(data.edits);
        setEditWorkflows(data.workflows);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [stageApi, detail.output, detail.approve, t]);

  const closeHelp = useCallback(() => setHelpOpen(false), []);

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
      fallbackError: t("page.saveFailed"),
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
            ...(detail.hasSpeech ? { speech: docs.speech } : {}),
            ...(detail.workflow ? { runWorkflow: detail.workflow } : {}),
            ...(agent.selected ? { provider: agent.selected } : {}),
            ...(agent.model ? { model: agent.model } : {}),
            ...(agent.selected && rememberForShot && !agent.isInitial ? { rememberForShot: true } : {}),
            ...(cloudCost && allowCloud ? { allowCloud: true } : {}),
            ...(stageId !== "final_render" ? { takes } : {}),
          },
          fallbackError: t("page.sendFailed"),
        },
      );
      setAllowCloud(false);
      stage.reset(data.stage);
      // Запрос ушёл — обратно к таблице, как «← Таблица».
      router.push(episodePagePath(episodeId, shotId));
      return data.message;
    });

  const chooseWorkflow = (workflowId: string) =>
    act(async () => {
      const data = await requestJson<StageDetail>(stageApi, {
        method: "PATCH",
        body: { runWorkflow: workflowId },
        fallbackError: t("page.workflowFailed"),
      });
      stage.merge(data);
    });

  const chooseDuration = (seconds: string) =>
    act(async () => {
      const data = await requestJson<StageDetail>(stageApi, {
        method: "PATCH",
        body: { runDuration: seconds },
        fallbackError: t("page.durationFailed"),
      });
      stage.merge(data);
    });

  const cancelStage = () =>
    act(async () => {
      const data = await requestJson<{ message: string; stage?: StageDetail }>(
        `${stageApi}/cancel`,
        { method: "POST", fallbackError: t("page.cancelFailed") },
      );
      if (data.stage) stage.merge(data.stage);
      return data.message;
    });

  const restorePrompt = (versionId: string) =>
    act(async () => {
      const data = await requestJson<StageDetail>(`${stageApi}/prompt-history`, {
        method: "POST",
        body: { versionId },
        fallbackError: t("page.restoreFailed"),
      });
      stage.reset(data);
      return t("page.restored");
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
        if (target === "refs" && editingCharacter) form.set("character", editingCharacter);
        const res = await fetch(`${stageApi}/upload`, { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t("page.uploadFailed"));
        await stage.reload();
        return t("page.uploaded", { name: data.savedAs });
      });
    };
    input.click();
  }

  const removeApproved = (filename: string) =>
    act(async () => {
      const data = await requestJson<{ stage?: StageDetail }>(`${stageApi}/approve`, {
        method: "DELETE",
        body: { filename },
        fallbackError: t("page.removeFailed"),
      });
      if (data.stage) stage.merge(data.stage);
      else await stage.reload();
      return t("page.removedApprove", { name: filename });
    });

  /** Удалить файл из output/ насовсем, после подтверждения. Ответ маршрута — StageDetail. */
  const deleteFile = (folder: "output", filename: string) => {
    if (!window.confirm(t("page.confirmDelete", { name: filename }))) return;
    void act(async () => {
      const data = await requestJson<StageDetail>(`${stageApi}/files`, {
        method: "DELETE",
        body: { folder, filename },
        fallbackError: t("page.deleteFailed"),
      });
      stage.merge(data);
      setSelectedOutput((prev) => prev.filter((item) => item !== filename));
      return t("page.deleted", { name: filename, folder });
    });
  };

  /** Убрать файл из графа этапа или вернуть. С диска ничего не удаляется. */
  const toggleExclude = (file: MediaFile, exclude: boolean) =>
    act(async () => {
      const data = await requestJson<StageDetail>(stageApi, {
        method: "PATCH",
        body: { exclude: { path: file.relativePath, excluded: exclude } },
        fallbackError: t("page.inputsFailed"),
      });
      stage.merge(data);
      return exclude ? t("page.excluded", { name: file.name }) : t("page.included", { name: file.name });
    });
  const excludeToggle = stageBusy || busy ? undefined : toggleExclude;

  const approveSelected = (names = selectedOutput) => {
    if (!names.length) {
      setMessage(t("page.pickOutput"));
      return;
    }
    void act(async () => {
      const data = await requestJson<{ approved: string[]; stage?: StageDetail }>(
        `${stageApi}/approve`,
        { method: "POST", body: { filenames: names, from: "output" }, fallbackError: t("page.approveFailed") },
      );
      setSelectedOutput([]);
      await stage.reload();
      const approved = data.approved.join(", ");
      return stageId === "characters" && data.stage?.status !== "approved"
        ? t("page.approvedPartial", { names: approved })
        : t("page.approved", { names: approved });
    });
  };

  const backToTable = () => router.push(episodePagePath(episodeId, shotId));
  const keys = useRef({ send: sendToAgent, approve: approveSelected, back: backToTable });
  useEffect(() => {
    keys.current = { send: sendToAgent, approve: approveSelected, back: backToTable };
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const recommendation =
        event.target instanceof HTMLTextAreaElement && event.target.id === "doc-llmNotes" && !event.target.readOnly;
      // Enter в рекомендации отправляет агенту. Shift+Enter остаётся переносом строки.
      if (recommendation && event.key === "Enter" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        keys.current.send();
        return;
      }
      if (event.ctrlKey && event.key === "Enter" && !event.shiftKey && !event.altKey && !event.metaKey) {
        if (recommendation) {
          event.preventDefault();
          keys.current.send();
        }
        return;
      }
      if (isTypingTarget(event.target) || overlayOpen()) return;
      if (event.code === "KeyA" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        keys.current.approve();
        return;
      }
      if (event.code === "Backquote" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        keys.current.back();
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const saveAction = (text: string) =>
    act(async () => {
      await requestJson(`${shotApi}/action`, { method: "PUT", body: { text }, fallbackError: t("page.actionFailed") });
      await stage.reload();
      return text.trim()
        ? t("page.actionSaved")
        : t("page.actionCleared");
    });

  const deleteNote = (id: string) =>
    act(async () => {
      await requestJson(`${shotApi}/notes`, { method: "DELETE", body: { id }, fallbackError: t("page.noteFailed") });
      await stage.reload();
      return t("page.noteRemoved");
    });

  const setWatch = (stopped: boolean) =>
    act(async () => {
      const data = await requestJson<StageDetail["watch"]>(`${shotApi}/watch`, {
        method: "POST",
        body: { stopped },
        fallbackError: t("page.watchFailed"),
      });
      await stage.reload();
      return data.videoDone
        ? t("page.watchVideo")
        : stopped
          ? t("page.watchStopped")
          : t("page.watchOn");
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
          <Link href={episodePagePath(episodeId, shotId)} className="text-sm text-teal-800 hover:underline">
            {t("page.back", { id: episodeId })}
          </Link>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl text-stone-950">
            {shotId} · {stageName(t, stageId)}
          </h1>
          <p className="mt-1 text-sm text-stone-600">{detail.shotTitle}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill status={detail.status} />
            <code className="break-all rounded bg-stone-100 px-2 py-1 text-xs text-stone-600">
              {detail.relativeDir}
            </code>
            <button type="button" className="text-sm text-teal-800 underline" onClick={() => setHelpOpen(true)}>
              {t("hotkey.button")}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LanguageSwitch />
          <Button variant="outline" disabled={busy} onClick={() => upload("refs")}>
            {t("page.uploadRef")}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => upload("output")}>
            {t("page.uploadOutput")}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => upload("output", true)}>
            {t("page.uploadApprove")}
          </Button>
          <Button
            variant="outline"
            disabled={busy || detail.watch.videoDone}
            onClick={() => setWatch(!detail.watch.stopped)}
          >
            {detail.watch.videoDone
              ? t("page.videoDone")
              : detail.watch.stopped
                ? t("page.watchAgain")
                : t("page.finish")}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => approveSelected()}>
            {t("page.approveSelected")}
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
              duration={{ range: detail.durationRange, selected: detail.durationSec }}
              onDuration={chooseDuration}
            />
          </div>
          {cloudCost && !stageBusy ? (
            <label className="flex w-full items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <input
                type="checkbox"
                className="mt-1"
                checked={allowCloud}
                disabled={busy}
                onChange={(event) => setAllowCloud(event.target.checked)}
              />
              <span>
                {t("page.cloud", { credits: cloudCost.credits, seconds: cloudCost.perSeconds })}
              </span>
            </label>
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
            <ShotContext
              detail={detail}
              disabled={busy}
              onSaveAction={saveAction}
              onDeleteNote={deleteNote}
            />
            <details className="text-xs text-stone-500">
              <summary className="cursor-pointer text-sm font-medium text-stone-800">
                {t("page.prompt")} <span className="font-normal text-stone-500">{t("page.promptNote")}</span>
              </summary>
              <div className="mt-2">
                {docField("prompt", {
                  readOnly: stageBusy,
                  placeholder: t("page.promptPlaceholder"),
                  className: "min-h-28",
                })}
              </div>
            </details>
            <PromptHistory
              versions={detail.promptHistory}
              disabled={busy}
              onRestore={restorePrompt}
            />
            {detail.hasSpeech ? (
              <details className="text-xs text-stone-500">
                <summary className="cursor-pointer text-sm font-medium text-stone-800">
                  {t("page.speech")} <span className="font-normal text-stone-500">{t("page.speechNote")}</span>
                </summary>
                <div className="mt-2">
                  {docField("speech", {
                    readOnly: stageBusy,
                    placeholder: t("page.speechPlaceholder"),
                    className: "min-h-16",
                  })}
                </div>
              </details>
            ) : null}
            <DocFieldLabel htmlFor="doc-llmNotes" note={t("page.recommendationNote")}>
              {t("page.recommendation")}
            </DocFieldLabel>
            {docField("llmNotes", {
              readOnly: stageBusy,
              placeholder: t("page.recommendationPlaceholder"),
              className: "min-h-24",
            })}
            {stage.dirty ? (
              <Button variant="outline" disabled={busy} onClick={() => act(async () => {
                await saveDocs();
                return t("page.saved");
              })}>
                {t("page.saveFields")}
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
              isShotAgent={agent.isInitial}
              rememberForShot={rememberForShot}
              onRememberForShot={setRememberChoice}
              onSend={sendToAgent}
              takes={stageId === "final_render" ? null : takes}
              onTakes={setTakes}
            />
            {detail.docs.runLog.trim() ? (
              <details className="text-xs text-stone-500">
                <summary className="cursor-pointer">{t("page.runLog")}</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
                  {detail.docs.runLog}
                </pre>
              </details>
            ) : null}
            <StageInputs
              inputs={
                editingCharacter
                  ? detail.inputs.filter((input) =>
                      input.label.toLowerCase().endsWith(` ${editingCharacter.toLowerCase()}`),
                    )
                  : detail.inputs
              }
              boardRuns={canRun}
              onOpen={(files, file) => openImage(files, file, false, "refs")}
              onToggleExclude={excludeToggle}
              characterSources={
                stageId === "characters"
                  ? { output: detail.output, refs: detail.refs, previous: detail.previousShot }
                  : undefined
              }
              onPickCharacter={
                stageId === "characters"
                  ? (name, file) => {
                      void act(async () => {
                        const data = await requestJson<StageDetail>(stageApi, {
                          method: "PATCH",
                          body: { characterImage: { name, path: file.relativePath } },
                          fallbackError: t("page.characterFailed"),
                        });
                        stage.merge(data);
                        return t("page.characterPicked", { name, file: file.name });
                      });
                    }
                  : undefined
              }
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <DocFieldLabel note={editingCharacter ? t("page.refsNoteOne", { name: editingCharacter }) : t("page.refsNote")}>
                {t("page.refs")}{editingCharacter ? `: ${editingCharacter}` : ""}
              </DocFieldLabel>
              <div className="flex flex-wrap gap-2">
                {stageId === "location" || stageId === "characters" ? (
                  <PrevShotRefButton
                    stageApi={stageApi}
                    disabled={busy || stageBusy}
                    onDone={(picked, text) => {
                      stage.merge(picked);
                      setMessage(text);
                    }}
                    onError={setMessage}
                  />
                ) : null}
                <RefSourcePicker
                  stageApi={stageApi}
                  disabled={busy}
                  onPicked={(picked, text) => {
                    stage.merge(picked);
                    setMessage(text);
                  }}
                />
              </div>
            </div>
            {stageId === "location" ? (
              <>
                <LocationLibrary stageApi={stageApi} disabled={busy} onPicked={(picked, text) => { stage.merge(picked); setMessage(text); }} />
                <LocationChoice
                  stageApi={stageApi}
                  location={detail.location}
                  disabled={busy || stageBusy}
                  onChanged={(picked, text) => {
                    stage.merge(picked);
                    setMessage(text);
                  }}
                />
              </>
            ) : null}
            <RefFiles
              files={
                editingCharacter
                  ? detail.refs.filter((file) => characterOwnsFile(file.name, editingCharacter))
                  : detail.refs
              }
              selectedName={selectedRef}
              usedNames={usedRefNames(detail.refs, detail.output, selectedOutput, shotId)}
              onSelect={(name) => setSelectedRef((current) => (current === name ? null : name))}
              onOpen={(file) =>
                openImage(
                  editingCharacter
                    ? detail.refs.filter((item) => characterOwnsFile(item.name, editingCharacter))
                    : detail.refs,
                  file,
                  false,
                  "refs",
                )
              }
              excluded={detail.excluded}
              onToggleExclude={excludeToggle}
            />
            <details className="text-xs text-stone-500">
              <summary className="cursor-pointer">{t("page.refsNoteFile")}</summary>
              <div className="mt-2">
                {docField("refs", { className: "min-h-24 font-mono text-xs" })}
              </div>
            </details>
            <details className="text-xs text-stone-500">
              <summary className="cursor-pointer">{t("page.workflowNote")}</summary>
              <div className="mt-2">
                {docField("workflow", { className: "min-h-24 font-mono text-xs" })}
              </div>
            </details>
            {stageId === "characters" ? (
              <CharacterRoster
                names={characterNames}
                active={editingCharacter}
                disabled={busy || stageBusy}
                onSelect={setActiveCharacter}
                onChange={(names) => {
                  void act(async () => {
                    const data = await requestJson<StageDetail>(stageApi, {
                      method: "PATCH",
                      body: { characters: names },
                      fallbackError: t("page.rosterFailed"),
                    });
                    stage.merge(data);
                    const added = data.expectedCharacters.find(
                      (name) => !characterNames.some((item) => item.toLowerCase() === name.toLowerCase()),
                    );
                    const still = data.expectedCharacters.find(
                      (name) => name.toLowerCase() === editingCharacter?.toLowerCase(),
                    );
                    setActiveCharacter(added ?? still ?? data.expectedCharacters[0] ?? null);
                    return data.expectedCharacters.length
                      ? t("page.roster", { names: data.expectedCharacters.join(", ") })
                      : t("page.nobody");
                  });
                }}
              />
            ) : null}
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
              {t("page.playbooksEmpty")}
            </p>
          )}
        </section>

        <OutputPanel
          detail={detail}
          edits={edits}
          disabled={busy}
          selectedOutput={selectedOutput}
          onToggle={toggleOutput}
          onOpen={(files, file, folder) => openImage(files, file, true, folder)}
          onApprove={approveSelected}
          onRemoveApproved={removeApproved}
          onDelete={(name) => deleteFile("output", name)}
          onEdit={(file, folder) => setEditing({ file, folder })}
          stageApi={stageApi}
          onStage={(next, text) => {
            if (next) stage.merge(next);
            setMessage(text);
          }}
        />
      </div>
      {viewer ? (
        <ImageLightbox
          files={viewer.files}
          index={viewer.index}
          onClose={closeViewer}
          onIndex={moveViewer}
          showRunContext={viewer.runContext}
          actions={
            viewer.folder === "refs"
              ? undefined
              : (file) => {
                  const folder = viewer.folder === "approve" ? "approve" : "output";
                  return (
                    <>
                      <button
                        type="button"
                        className="rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white"
                        onClick={() => setEditing({ file, folder })}
                      >
                        {t("page.edit")}
                      </button>
                      {folder === "output" ? (
                        <button
                          type="button"
                          className="rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white"
                          onClick={() => {
                            closeViewer();
                            approveSelected([file.name]);
                          }}
                        >
                          {t("page.approve")}
                        </button>
                      ) : null}
                    </>
                  );
                }
          }
        />
      ) : null}
      <HotkeyHelp open={helpOpen} onClose={closeHelp} />
      {editing ? (
        <ImageEditDialog
          file={editing.file}
          folder={editing.folder}
          stageApi={stageApi}
          workflows={editWorkflows}
          onClose={() => setEditing(null)}
          onCropped={(text) => {
            setEditing(null);
            void act(async () => {
              await stage.reload();
              await loadEdits();
              return text;
            });
          }}
          onEditQueued={(text) => {
            setEditing(null);
            void act(async () => {
              await stage.reload();
              await loadEdits();
              return text;
            });
          }}
        />
      ) : null}
    </div>
  );
}
