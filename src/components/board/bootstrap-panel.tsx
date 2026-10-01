"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BootstrapPreview } from "@/lib/series/types";

interface BootstrapPanelProps {
  initialEpisodeId: string | null;
  episodes: string[];
  initialScenario: string;
  initialRawScenario: string;
  initialPreview: BootstrapPreview;
  formatRequestStatus: "pending" | "done" | null;
  onImported: () => void;
}

export function BootstrapPanel({
  initialEpisodeId,
  episodes,
  initialScenario,
  initialRawScenario,
  initialPreview,
  formatRequestStatus,
  onImported,
}: BootstrapPanelProps) {
  const [episodeId, setEpisodeId] = useState(initialEpisodeId || "e01");
  const [raw, setRaw] = useState(initialRawScenario);
  const [scenario, setScenario] = useState(initialScenario);
  const [preview, setPreview] = useState<BootstrapPreview>(initialPreview);
  const [selected, setSelected] = useState<string[]>(
    initialPreview.shots.map((shot) => shot.id),
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function openEpisode(id = episodeId) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/series/episode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: id }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось открыть эпизод");
      setEpisodeId(data.episodeId);
      setMessage(`Текущий эпизод: ${data.episodeId}`);
      onImported();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function sendRawToAgent() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/series/format-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId, rawText: raw }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось записать сценарий");
      setMessage(data.message);
      onImported();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function previewScenario() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/series/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, previewOnly: true }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось разобрать сценарий");
      setPreview(data.preview);
      setSelected(data.preview.shots.map((shot: { id: string }) => shot.id));
      setMessage(
        data.preview.shots.length
          ? `Найдено кадров: ${data.preview.shots.length}. Снятая галка не удаляет кадр из таблицы, а только не создаёт его в этот раз.`
          : "В этом тексте нет кадров «## s01». Скрипт папки из него не соберёт. Сырой сценарий отправь агенту верхним полем.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function applySelected() {
    if (!selected.length) {
      setMessage(
        preview.shots.length
          ? "Оставь галку хотя бы на одном кадре. Снятая галка не удаляет уже созданный кадр."
          : "Сначала нажми «Предпросмотр». Если кадров нет, это сырой текст: отправь его верхним полем, агент разметит его в Cursor.",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/series/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario,
          shotIds: selected,
          overwriteDocs: false,
          episodeId,
        }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось создать структуру");
      setMessage(
        `Создано: ${data.created.join(", ") || "—"} · обновлено: ${data.updated.join(", ") || "—"} · без галки: ${data.skipped.join(", ") || "—"}`,
      );
      onImported();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  function toggleShot(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  return (
    <section className="rounded-2xl border border-stone-300/70 bg-white/75 p-5 backdrop-blur">
      <div className="mb-4">
        <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-stone-900">
          Эпизод и сценарий
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">
          Один сериал. Общие персонажи и локации лежат в <code>data/characters</code> и{" "}
          <code>data/locations</code>. Кадры эпизода — в <code>data/episodes/имя/</code>.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-40 flex-col gap-1 text-xs font-medium text-stone-600">
          Имя эпизода
          <Input
            value={episodeId}
            onChange={(event) => setEpisodeId(event.target.value)}
            placeholder="e01"
            className="font-mono"
          />
        </label>
        <Button type="button" variant="outline" disabled={busy} onClick={() => openEpisode()}>
          Открыть эпизод
        </Button>
      </div>
      {episodes.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {episodes.map((id) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={id === initialEpisodeId ? "secondary" : "outline"}
              disabled={busy}
              onClick={() => openEpisode(id)}
            >
              {id}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="mt-6">
        <h3 className="text-sm font-medium text-stone-800">Сырой сценарий</h3>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">
          Сюда вставляется текст как есть. Кнопка только записывает файл и строку во
          входящие. Агент сам не стартует: после неё открой Cursor в папке этого
          репозитория и попроси разобрать входящие эпизода.
        </p>
        <Textarea
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          className="mt-3 min-h-36 font-mono text-xs"
          placeholder="Вставь сценарий без разметки кадров."
        />
        <Button type="button" className="mt-3" variant="secondary" disabled={busy} onClick={sendRawToAgent}>
          Отправить на разметку
        </Button>
        {formatRequestStatus === "pending" ? (
          <p className="mt-2 text-sm text-stone-600">
            Разметка ждёт агента. В локальном Cursor напиши: разбери agent_inbox текущего
            эпизода и отформатируй scenario_raw.md в scenario.md. Папки шотов не создавай.
          </p>
        ) : null}
      </div>

      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-stone-800">Размеченный сценарий</h3>
            <p className="mt-1 max-w-3xl text-sm text-stone-600">
              «Создать выбранные» запускает скрипт в доске. Он создаёт папки только из
              заголовков <code>## s01</code>. Агента не вызывает. Снятая галка не удаляет
              уже существующий кадр.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={previewScenario}>
              Предпросмотр
            </Button>
            <Button type="button" disabled={busy} onClick={applySelected}>
              Создать выбранные
            </Button>
          </div>
        </div>
        <Textarea
          value={scenario}
          onChange={(event) => {
            setScenario(event.target.value);
            setPreview((current) => ({ ...current, shots: [] }));
            setSelected([]);
          }}
          className="min-h-48 font-mono text-xs"
          placeholder={`# Название эпизода\n\n## s01 Вход в кафе\n- characters: lena, mark\n- location: night_cafe\nЛена входит, Марк оборачивается.`}
        />
        {preview.shots.length ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {preview.shots.map((shot) => {
              const checked = selected.includes(shot.id);
              return (
                <label
                  key={shot.id}
                  className="flex cursor-pointer gap-3 rounded-xl border border-stone-200 bg-stone-50/80 p-3"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleShot(shot.id)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium text-stone-900">
                      {shot.id} · {shot.title}
                    </span>
                    <span className="mt-1 block text-xs text-stone-500">
                      {shot.characters.join(", ") || "без персонажей"} ·{" "}
                      {shot.location || "локация не задана"}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : null}
      </div>

      {message ? <p className="mt-3 text-sm text-stone-600">{message}</p> : null}
    </section>
  );
}
