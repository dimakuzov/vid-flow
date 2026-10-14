"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FORMAT_CLAUDE_MODEL } from "@/lib/agent/config";
import { ProviderSelect, useAgentProviders } from "@/components/stage/agent-provider";
import { errorText, requestJson } from "@/components/stage/api";

interface ScenarioFile {
  name: string;
  bytes: number;
  modifiedAt: string;
}

/**
 * «Добавить» в шапке: новая серия из сценария. Сценарий — из библиотеки data/scenarios/,
 * из файла или вставкой. Выбранная модель размечает его на кадры, доска сама собирает таблицу.
 */
export function NewEpisodeDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (episodeId: string) => void;
}) {
  const [episodeId, setEpisodeId] = useState("");
  const [scenarios, setScenarios] = useState<ScenarioFile[] | null>(null);
  const [scenarioFile, setScenarioFile] = useState("");
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const agent = useAgentProviders("text", null, undefined, FORMAT_CLAUDE_MODEL);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    requestJson<{ scenarios: ScenarioFile[] }>("/api/series/scenarios")
      .then((data) => {
        if (!stopped) setScenarios(data.scenarios);
      })
      .catch(() => {
        if (!stopped) setScenarios([]);
      });
    return () => {
      stopped = true;
    };
  }, [open]);

  async function readFile(file: File | null) {
    if (!file) return;
    setRaw(await file.text());
    setScenarioFile("");
  }

  async function create() {
    setBusy(true);
    setError("");
    try {
      const data = await requestJson<{ episodeId: string }>("/api/series/new-episode", {
        method: "POST",
        body: {
          episodeId,
          rawText: raw.trim() ? raw : undefined,
          scenarioFile: raw.trim() ? undefined : scenarioFile || undefined,
          provider: agent.selected ?? undefined,
          model: agent.model ?? undefined,
        },
        fallbackError: "Не удалось создать серию",
      });
      onOpenChange(false);
      setEpisodeId("");
      setRaw("");
      setScenarioFile("");
      onCreated(data.episodeId);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const hasScenario = Boolean(raw.trim() || scenarioFile);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая серия</DialogTitle>
          <DialogDescription>
            Выберите сценарий и модель. Модель разметит его на кадры, доска сама соберёт таблицу.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-sm">
          <label className="grid gap-1 text-xs text-stone-600">
            Имя серии (латиница, цифры, _ и -)
            <input
              value={episodeId}
              onChange={(event) => setEpisodeId(event.target.value)}
              placeholder="e02"
              className="h-9 rounded-lg border border-stone-300 bg-white px-2 font-mono text-sm text-stone-900"
            />
          </label>

          <div className="grid gap-1 text-xs text-stone-600">
            <label htmlFor="new-episode-scenario">Сценарий из библиотеки (data/scenarios/)</label>
            <select
              id="new-episode-scenario"
              value={scenarioFile}
              disabled={busy || Boolean(raw.trim())}
              onChange={(event) => setScenarioFile(event.target.value)}
              className="h-9 rounded-lg border border-stone-300 bg-white px-2 text-sm text-stone-900 disabled:opacity-60"
            >
              <option value="">{scenarios === null ? "Загрузка…" : scenarios.length ? "— не выбран —" : "— в библиотеке пусто —"}</option>
              {(scenarios ?? []).map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1 text-xs text-stone-600">
            <span>Или текст сценария (вставить или открыть файл .md / .txt)</span>
            <Textarea
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              placeholder="Сырой сценарий без разметки кадров."
              className="min-h-32 font-mono text-xs"
              disabled={busy}
            />
            <input
              type="file"
              accept=".md,.txt,text/plain,text/markdown"
              disabled={busy}
              onChange={(event) => readFile(event.target.files?.[0] ?? null)}
              className="text-xs"
            />
          </div>

          {agent.providers ? (
            <ProviderSelect
              id="new-episode-provider"
              providers={agent.providers}
              selected={agent.selected}
              mode="text"
              disabled={busy}
              onChoose={agent.choose}
              model={agent.model}
              onChooseModel={agent.chooseModel}
            />
          ) : null}
          {agent.selected === "manual" ? (
            <p className="text-xs text-stone-500">
              Агент в чате: разметка попадёт во входящие эпизода, таблицу соберёте кнопкой «Создать выбранные» в импорте.
            </p>
          ) : null}

          {error ? <p className="text-sm text-red-800">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button disabled={busy || !episodeId.trim() || !hasScenario} onClick={create}>
              {busy ? "Создание…" : "Разметить и собрать таблицу"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
