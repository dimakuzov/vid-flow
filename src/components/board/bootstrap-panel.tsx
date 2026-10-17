"use client";

import { useState } from "react";
import { useT } from "@/components/language";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { BootstrapPreview, BootstrapShotDraft } from "@/lib/series/types";

interface TableShot {
  id: string;
  title: string;
  characters: string[];
  location: string;
}

interface BootstrapPanelProps {
  initialEpisodeId: string | null;
  tableShots: TableShot[];
  /** Кадры, спрятанные из таблицы. Папки на диске целы. */
  hiddenShots: TableShot[];
  initialScenario: string;
  initialRawScenario: string;
  initialPreview: BootstrapPreview;
  formatRequestStatus: "pending" | "running" | "done" | "error" | null;
  onImported: () => void;
}

function sortShots(shots: BootstrapShotDraft[]): BootstrapShotDraft[] {
  return [...shots].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function BootstrapPanel({
  initialEpisodeId,
  tableShots,
  hiddenShots,
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

  if (seenTable !== tableKey) {
    setSeenTable(tableKey);
    setSelected(tableShots.map((shot) => shot.id));
  }

  const cards = sortShots(
    (() => {
      const byId = new Map<string, BootstrapShotDraft>();
      for (const shot of tableShots) {
        byId.set(shot.id, {
          id: shot.id,
          title: shot.title,
          summary: "",
          characters: shot.characters,
          location: shot.location,
        });
      }
      for (const shot of hiddenShots) {
        if (!byId.has(shot.id)) {
          byId.set(shot.id, {
            id: shot.id,
            title: shot.title,
            summary: "",
            characters: shot.characters,
            location: shot.location,
          });
        }
      }
      for (const shot of preview.shots) {
        const current = byId.get(shot.id);
        byId.set(shot.id, current ? { ...current, ...shot, summary: shot.summary } : shot);
      }
      return [...byId.values()];
    })(),
  );

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
          ? await fetch(`/api/episodes/${initialEpisodeId}/shots/${id}`, {
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
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((shot) => {
            const checked = selected.includes(shot.id);
            return (
              <label
                key={shot.id}
                className="flex cursor-pointer gap-3 rounded-xl border border-stone-200 bg-stone-50/80 p-3"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={() => toggleShot(shot.id)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium text-stone-900">
                    {shot.id} · {shot.title}
                  </span>
                  <span className="mt-1 block text-xs text-stone-500">
                    {shot.characters.join(", ") || t("import.noCharacters")} ·{" "}
                    {shot.location || t("board.noLocation")}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="mb-4 text-sm text-stone-500">
          {t("import.noCards")}
        </p>
      )}

      <h3 className="text-sm font-medium text-stone-800">{t("import.marked")}</h3>
      <Textarea
        value={scenario}
        onChange={(event) => setScenario(event.target.value)}
        className="mt-2 min-h-48 font-mono text-xs"
        placeholder={t("import.placeholder")}
      />

      <div className="mt-6">
        <h3 className="text-sm font-medium text-stone-800">{t("import.raw")}</h3>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">{t("import.rawLead")}</p>
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
      </div>

      {message ? <p className="mt-3 text-sm text-stone-600">{message}</p> : null}
    </section>
  );
}
