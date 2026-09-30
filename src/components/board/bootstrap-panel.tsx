"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { BootstrapPreview } from "@/lib/series/types";

interface BootstrapPanelProps {
  onImported: () => void;
}

export function BootstrapPanel({ onImported }: BootstrapPanelProps) {
  const [scenario, setScenario] = useState("");
  const [preview, setPreview] = useState<BootstrapPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/series/bootstrap");
      const data = await res.json();
      if (res.ok) {
        setScenario(data.scenario || "");
        setPreview(data.preview || null);
        setSelected((data.preview?.shots || []).map((shot: { id: string }) => shot.id));
      }
    })();
  }, []);

  async function previewScenario() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/series/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, previewOnly: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось разобрать сценарий");
      setPreview(data.preview);
      setSelected(data.preview.shots.map((shot: { id: string }) => shot.id));
      setMessage(`Найдено кадров: ${data.preview.shots.length}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function applySelected() {
    if (!selected.length) {
      setMessage("Выберите хотя бы один кадр");
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось создать структуру");
      setMessage(
        `Создано: ${data.created.join(", ") || "—"} · обновлено: ${data.updated.join(", ") || "—"}`,
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
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-stone-900">
            Импорт сценария
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Отдельное задание: разобрать весь сценарий серии и создать папки
            shots/stages. Повторный импорт спрашивает подтверждение по каждому
            кадру через выбор ниже.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={previewScenario}>
            Предпросмотр
          </Button>
          <Button disabled={busy} onClick={applySelected}>
            Создать выбранные
          </Button>
        </div>
      </div>

      <Textarea
        value={scenario}
        onChange={(event) => setScenario(event.target.value)}
        className="min-h-48 font-mono text-xs"
        placeholder={`# Название серии\n\n## s01 Вход в кафе\n- characters: lena, mark\n- location: night_cafe\nЛена входит, Марк оборачивается.`}
      />

      {preview?.shots?.length ? (
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

      {message ? <p className="mt-3 text-sm text-stone-600">{message}</p> : null}
    </section>
  );
}
