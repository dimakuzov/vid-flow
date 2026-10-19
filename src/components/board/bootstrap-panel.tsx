"use client";

import { useRef, useState } from "react";
import { useT } from "@/components/language";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { rawSceneText } from "@/lib/series/format-guard";
import type { BootstrapPreview, BootstrapShotDraft } from "@/lib/series/types";

interface TableShot {
  id: string;
  title: string;
  summary: string;
  /** null — фрагмент ещё не правили, в карточке текст из сырого сценария. */
  fragment: string | null;
  characters: string[];
  location: string;
}

interface BootstrapPanelProps {
  initialEpisodeId: string | null;
  tableShots: TableShot[];
  /** Кадры, спрятанные из таблицы. Папки на диске целы. */
  hiddenShots: TableShot[];
  /** Порядок всех кадров, включая скрытые. */
  shotOrder: string[];
  initialScenario: string;
  initialRawScenario: string;
  initialPreview: BootstrapPreview;
  formatRequestStatus: "pending" | "running" | "done" | "error" | null;
  onImported: () => void;
}

function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Текст фрагмента в карточке. Уход из поля записывает его в этот кадр. */
function ShotFragment({
  episodeId,
  shotId,
  text,
  disabled,
  onSaved,
}: {
  episodeId: string;
  shotId: string;
  text: string;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(text);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const pending = useRef<string | null>(null);
  if (!focused && pending.current !== null && text === pending.current) pending.current = null;
  if (!focused && !error && pending.current === null && value !== text) setValue(text);

  async function commit() {
    setFocused(false);
    if (value === text) return;
    pending.current = value;
    setError("");
    try {
      const res = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}/shots/${encodeURIComponent(shotId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fragment: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не сохранилось");
      onSaved();
    } catch (err) {
      pending.current = null;
      setError(err instanceof Error ? err.message : "Не сохранилось");
    }
  }

  async function prepare() {
    const source = value.trim();
    if (!source) {
      setError("Сначала впиши текст кадра");
      return;
    }
    setPreparing(true);
    setError("");
    try {
      const res = await fetch(
        `/api/episodes/${encodeURIComponent(episodeId)}/shots/${encodeURIComponent(shotId)}/prepare`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: source }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось подготовить кадр");
      pending.current = source;
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось подготовить кадр");
    } finally {
      setPreparing(false);
    }
  }

  return (
    <>
      <Textarea
        value={value}
        disabled={disabled || preparing}
        onChange={(event) => setValue(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => void commit()}
        className="mt-2 min-h-28 text-sm leading-relaxed"
        placeholder="Текст этого кадра"
      />
      <Button
        type="button"
        variant="secondary"
        className="mt-2"
        disabled={disabled || preparing || !value.trim()}
        onClick={() => void prepare()}
      >
        {preparing ? "Готовлю кадр…" : "Подготовить кадр"}
      </Button>
      <p className="mt-1 text-xs text-stone-500">
        По тексту выше заполнит персонажей, локацию, реплики, длительность и действие. Другие кадры не трогает.
      </p>
      {error ? <p className="mt-1 text-sm text-red-800">{error}</p> : null}
    </>
  );
}

export function BootstrapPanel({
  initialEpisodeId,
  tableShots,
  hiddenShots,
  shotOrder,
  initialScenario,
  initialRawScenario,
  initialPreview,
  formatRequestStatus,
  onImported,
}: BootstrapPanelProps) {
  const t = useT();
  const tableKey = tableShots.map((shot) => shot.id).join(",");
  const [raw, setRaw] = useState(initialRawScenario);
  const [scenario, setScenario] = useState(initialScenario);
  const [preview, setPreview] = useState<BootstrapPreview>(initialPreview);
  const [selected, setSelected] = useState<string[]>(tableShots.map((shot) => shot.id));
  const [seenTable, setSeenTable] = useState(tableKey);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [dragId, setDragId] = useState("");
  const orderKey = shotOrder.join("\n");
  const [order, setOrder] = useState(shotOrder);
  const [seenOrder, setSeenOrder] = useState(orderKey);
  if (seenOrder !== orderKey) {
    setSeenOrder(orderKey);
    setOrder(shotOrder);
  }

  if (seenTable !== tableKey) {
    setSeenTable(tableKey);
    setSelected(tableShots.map((shot) => shot.id));
  }

  const byId = new Map<string, BootstrapShotDraft & { fragment: string | null; onDisk: boolean }>();
  for (const shot of tableShots) {
    byId.set(shot.id, {
      id: shot.id,
      title: shot.title,
      summary: shot.summary,
      fragment: shot.fragment,
      onDisk: true,
      characters: shot.characters,
      location: shot.location,
    });
  }
  for (const shot of hiddenShots) {
    if (!byId.has(shot.id)) {
      byId.set(shot.id, {
        id: shot.id,
        title: shot.title,
        summary: shot.summary,
        fragment: shot.fragment,
        onDisk: true,
        characters: shot.characters,
        location: shot.location,
      });
    }
  }
  for (const shot of preview.shots) {
    const current = byId.get(shot.id);
    byId.set(
      shot.id,
      current
        ? {
            ...shot,
            ...current,
            title: current.title,
            summary: current.summary.trim() || shot.summary,
            fragment: current.fragment,
            onDisk: true,
          }
        : { ...shot, fragment: null, onDisk: false },
    );
  }
  const orderedIds = order.filter((id) => [...byId.keys()].some((key) => sameId(key, id)));
  for (const id of byId.keys()) {
    if (!orderedIds.some((item) => sameId(item, id))) orderedIds.push(id);
  }
  const cards = orderedIds.flatMap((id) => {
    const shot = [...byId.entries()].find(([key]) => sameId(key, id))?.[1];
    return shot ? [shot] : [];
  });

  async function sendRawToAgent() {
    if (!initialEpisodeId) {
      setMessage(t("import.needSeries"));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/series/format-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: initialEpisodeId, rawText: raw }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("import.writeFailed"));
      setMessage(data.message);
      onImported();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("common.error"));
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
      if (!res.ok) throw new Error(data.error || t("import.parseFailed"));
      setPreview(data.preview);
      setMessage(
        data.preview.shots.length
          ? t("import.parsed", { n: data.preview.shots.length })
          : t("import.noBlocks"),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleShot(id: string) {
    const removing = selected.includes(id);
    if (!initialEpisodeId) {
      setMessage(t("import.needSeries"));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const hidden = hiddenShots.some((shot) => shot.id === id);
      const res =
        removing || hidden
          ? await fetch(`/api/episodes/${encodeURIComponent(initialEpisodeId)}/shots/${encodeURIComponent(id)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ hidden: removing }),
            })
          : await fetch("/api/series/bootstrap", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                scenario,
                shotIds: [id],
                overwriteDocs: false,
                episodeId: initialEpisodeId,
              }),
              cache: "no-store",
            });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("import.toggleFailed"));
      setSelected((prev) => (removing ? prev.filter((item) => item !== id) : [...prev, id]));
      setMessage(removing ? t("import.hidden", { id }) : t("import.shown", { id }));
      onImported();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function moveShot(fromId: string, toId: string) {
    if (!initialEpisodeId || sameId(fromId, toId)) return;
    const ids = cards.map((shot) => shot.id);
    const from = ids.findIndex((id) => sameId(id, fromId));
    const to = ids.findIndex((id) => sameId(id, toId));
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/episodes/${initialEpisodeId}/shot-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось поменять порядок");
      onImported();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
      setOrder(shotOrder);
    } finally {
      setBusy(false);
      setDragId("");
    }
  }

  async function addShot() {
    if (!initialEpisodeId) {
      setMessage("Сначала выбери или добавь серию в заголовке");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/episodes/${initialEpisodeId}/shots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: newId, title: newName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось добавить кадр");
      setNewId("");
      setNewName("");
      setAdding(false);
      setMessage(`${data.shotId} добавлен в конец`);
      onImported();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-stone-300/70 bg-white/75 p-5 backdrop-blur">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-stone-900">
            {t("import.title")}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-stone-600">{t("import.lead")}</p>
        </div>
        <Button type="button" variant="outline" disabled={busy} onClick={previewScenario}>
          {t("import.preview")}
        </Button>
      </div>

      {cards.length ? (
        <div className="mb-4 flex flex-col gap-3">
          {cards.map((shot) => {
            const checked = selected.includes(shot.id);
            const text = rawSceneText(raw, shot.id) || shot.summary.trim();
            return (
              <div
                key={shot.id}
                onDragOver={(event) => {
                  if (!dragId) return;
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const fromId = event.dataTransfer.getData("text/plain") || dragId;
                  void moveShot(fromId, shot.id);
                }}
                className={`flex w-full gap-3 rounded-xl border bg-stone-50/80 p-4 ${
                  dragId && sameId(dragId, shot.id) ? "border-teal-700" : "border-stone-200"
                }`}
              >
                <button
                  type="button"
                  draggable
                  disabled={busy}
                  aria-label="Переместить кадр"
                  title="Перетащить, чтобы изменить порядок"
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", shot.id);
                    event.dataTransfer.effectAllowed = "move";
                    setDragId(shot.id);
                  }}
                  onDragEnd={() => setDragId("")}
                  className="mt-1 flex cursor-grab flex-col gap-1 px-1 text-stone-400 active:cursor-grabbing disabled:opacity-40"
                >
                  <span className="h-1 w-1 rounded-full bg-current" />
                  <span className="h-1 w-1 rounded-full bg-current" />
                  <span className="h-1 w-1 rounded-full bg-current" />
                </button>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={() => toggleShot(shot.id)}
                  className="mt-1"
                  aria-label={checked ? "Скрыть кадр из таблицы" : "Показать кадр в таблице"}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-stone-900">
                    {shot.id} · {shot.title}
                  </div>
                  {shot.onDisk && initialEpisodeId ? (
                    <ShotFragment
                      episodeId={initialEpisodeId}
                      shotId={shot.id}
                      text={shot.fragment ?? (rawSceneText(raw, shot.id) || shot.summary.trim())}
                      disabled={busy}
                      onSaved={onImported}
                    />
                  ) : text ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{rawSceneText(raw, shot.id) || shot.summary.trim()}</p>
                  ) : (
                    <p className="mt-2 text-sm text-stone-400">В исходном сценарии для этого кадра нет текста.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mb-4 text-sm text-stone-500">
          {t("import.noCards")}
        </p>
      )}

      {adding ? (
        <div className="mb-4 space-y-2 rounded-xl border border-stone-200 bg-white p-4">
          <label className="block text-sm text-stone-700">
            Id
            <input
              value={newId}
              onChange={(event) => setNewId(event.target.value)}
              placeholder="s04"
              className="mt-1 h-9 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
            />
          </label>
          <label className="block text-sm text-stone-700">
            Имя
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Кухня вечером"
              className="mt-1 h-9 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
            />
          </label>
          <p className="text-xs text-stone-500">
            Потом впиши текст кадра и нажми «Подготовить кадр»: так появятся персонажи, локация, реплики и действие.
          </p>
          <div className="flex gap-2">
            <Button type="button" disabled={busy} onClick={() => void addShot()}>
              Создать кадр
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setAdding(false)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" className="mb-4" disabled={busy} onClick={() => setAdding(true)}>
          Добавить кадр
        </Button>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-medium text-stone-800">Размеченный сценарий</summary>
        <Textarea
          value={scenario}
          onChange={(event) => setScenario(event.target.value)}
          className="mt-2 min-h-48 font-mono text-xs"
          placeholder={`# Ночная смена\n\n## s01 Вход в кафе\n- characters: lena, mark\n- location: night_cafe\nЛена входит, Марк оборачивается.`}
        />
      </details>

      <details className="mt-6">
        <summary className="cursor-pointer text-sm font-medium text-stone-800">Сырой сценарий</summary>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">
          Текст как есть. Кнопка только записывает файл. Агент сам не стартует: после
          неё попроси Cursor в этой папке разобрать входящие серии.
        </p>
        <Textarea
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          className="mt-3 min-h-36 font-mono text-xs"
          placeholder={t("import.rawPlaceholder")}
        />
        <Button type="button" className="mt-3" variant="secondary" disabled={busy} onClick={sendRawToAgent}>
          {t("import.send")}
        </Button>
        {formatRequestStatus === "pending" ? (
          <p className="mt-2 text-sm text-stone-600">{t("import.pending")}</p>
        ) : null}
      </details>

      {message ? <p className="mt-3 text-sm text-stone-600">{message}</p> : null}
    </section>
  );
}
