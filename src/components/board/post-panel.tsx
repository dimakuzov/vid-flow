"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/language";
import { errorText, requestJson } from "@/components/stage/api";
import type { MessageKey, Translate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import type { PostCharacterView, PostLineView, PostState } from "@/lib/post/state";
import type { VoiceJob } from "@/lib/post/voice-job";

/*
 * Секция «Пост» под таблицей кадров (docs/contracts/post.md): озвучка реплик в ElevenLabs
 * и проект Kdenlive. Субтитры — следующая часть.
 */

const SIZES = [
  { label: "720×1280", width: 720, height: 1280 },
  { label: "768×1344", width: 768, height: 1344 },
  { label: "1080×1920", width: 1080, height: 1920 },
];

type SpeechStatusView = PostState["shots"][number]["speech"]["status"];

const SPEECH_KEY: Record<SpeechStatusView, MessageKey> = {
  none: "speech.none",
  queued: "speech.queued",
  running: "speech.running",
  done: "speech.done",
  error: "speech.error",
  stale: "speech.stale",
};

const SPEECH_STYLES: Record<SpeechStatusView, string> = {
  none: "border-stone-300 text-stone-500",
  queued: "border-sky-300 bg-sky-50 text-sky-900",
  running: "border-sky-300 bg-sky-50 text-sky-900",
  done: "border-emerald-300 bg-emerald-50 text-emerald-900",
  error: "border-red-300 bg-red-50 text-red-900",
  stale: "border-amber-300 bg-amber-50 text-amber-900",
};

const VOICE_KEY: Record<PostLineView["voice"], MessageKey | null> = {
  ok: null,
  "no-voice": "voice.no",
  stale: "voice.stale",
  "no-character": "voice.noName",
};

function postApi(episodeId: string, tail = ""): string {
  return `/api/episodes/${encodeURIComponent(episodeId)}/post${tail}`;
}

function voiceText(tr: Translate, voice: PostLineView["voice"]): string {
  const key = VOICE_KEY[voice];
  return key ? tr(key) : "";
}

function seconds(value: number): string {
  return `${Math.round(value * 100) / 100}`;
}

function jobText(job: VoiceJob, tr: Translate): string {
  const what = job.kind === "isolate" ? tr("post.job.isolate") : tr("post.job.voice");
  if (job.status === "pending") return tr("post.job.queued", { what });
  if (job.status === "running") return tr("post.job.running", { what, progress: job.progress ?? tr("post.job.eleven") });
  if (job.status === "error") return tr("post.job.failed", { what, error: job.error ?? tr("post.job.errorWord") });
  const versions = job.results.map((item) => `${item.character} v${item.version}`).join(", ");
  const failed = job.results.filter((item) => item.isolation === "error");
  const cost =
    job.kind === "isolate"
      ? tr("post.job.isolateCost", { n: job.isolationChars ?? 0 })
      : tr("post.job.voiceCost", {
          chars: job.chars,
          extra: job.isolationChars ? tr("post.job.voiceCostExtra", { n: job.isolationChars }) : "",
        });
  const done = tr(job.kind === "isolate" ? "post.job.isolated" : "post.job.voiced", { versions, cost });
  return failed.length
    ? tr("post.job.isolateMiss", {
        done,
        who: failed.map((item) => `${item.character} (${item.isolationError ?? tr("post.job.errorWord")})`).join(", "),
      })
    : done;
}

/** Поле секунд: правка уходит на сервер по Enter или при уходе с поля. */
function SecondsInput({
  value,
  onCommit,
  title,
  disabled,
}: {
  value: number;
  onCommit: (value: number) => void;
  title: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(seconds(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(seconds(value));
  }
  const commit = () => {
    const parsed = Number(draft.replace(",", "."));
    if (!Number.isFinite(parsed)) {
      setDraft(seconds(value));
      return;
    }
    if (Math.abs(parsed - value) > 0.0005) onCommit(parsed);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      title={title}
      disabled={disabled}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
      className="w-16 rounded-md border border-stone-300 bg-white px-1.5 py-0.5 text-right font-mono text-xs disabled:bg-stone-100 disabled:text-stone-400"
    />
  );
}

function VoiceForm({
  character,
  busy,
  onSave,
  onCancel,
}: {
  character: PostCharacterView;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const config = character.config;
  const [voiceId, setVoiceId] = useState(config?.voice_id ?? "");
  const [modelId, setModelId] = useState(config?.model_id ?? "eleven_v3");
  const [stability, setStability] = useState(String(config?.voice_settings?.stability ?? ""));
  const [similarity, setSimilarity] = useState(String(config?.voice_settings?.similarity_boost ?? ""));
  const [style, setStyle] = useState(String(config?.voice_settings?.style ?? ""));
  const [speed, setSpeed] = useState(String(config?.voice_settings?.speed ?? ""));
  const [seed, setSeed] = useState(config?.seed === undefined ? "" : String(config.seed));
  const [prefix, setPrefix] = useState(config?.text_prefix ?? "[strong Russian accent]");
  const [isolate, setIsolate] = useState(config?.isolate ?? true);

  const num = (value: string) => (value.trim() === "" ? undefined : Number(value.replace(",", ".")));
  const field = "rounded-md border border-stone-300 bg-white px-2 py-1 text-xs";
  return (
    <div className="mt-2 grid gap-2 rounded-lg border border-stone-200 bg-white p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <label className="flex flex-col gap-1 sm:col-span-2">
        {t("voice.voiceId")}
        <input className={`${field} font-mono`} value={voiceId} onChange={(event) => setVoiceId(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2">
        model_id
        <input className={`${field} font-mono`} value={modelId} onChange={(event) => setModelId(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
        {t("voice.prefix")}
        <input className={`${field} font-mono`} value={prefix} onChange={(event) => setPrefix(event.target.value)} />
      </label>
      <label className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
        <input type="checkbox" checked={isolate} onChange={(event) => setIsolate(event.target.checked)} />
        {t("voice.isolate")}
      </label>
      <label className="flex flex-col gap-1">
        stability
        <input className={field} value={stability} placeholder="0.5" onChange={(event) => setStability(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        similarity_boost
        <input className={field} value={similarity} placeholder="0.75" onChange={(event) => setSimilarity(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        style
        <input className={field} value={style} placeholder="0" onChange={(event) => setStyle(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        speed
        <input className={field} value={speed} placeholder="1.0" onChange={(event) => setSpeed(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        {t("voice.seed")}
        <input className={field} value={seed} onChange={(event) => setSeed(event.target.value)} />
      </label>
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            onSave({
              character: character.name,
              voice_id: voiceId,
              model_id: modelId,
              voice_settings: {
                stability: num(stability),
                similarity_boost: num(similarity),
                style: num(style),
                speed: num(speed),
              },
              seed: num(seed),
              text_prefix: prefix,
              isolate,
            })
          }
        >
          {t("voice.save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <span className="text-stone-500">{t("voice.savedTo", { name: character.name })}</span>
      </div>
    </div>
  );
}

export function PostPanel({ episodeId }: { episodeId: string }) {
  const t = useT();
  const [state, setState] = useState<PostState | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [allowPaid, setAllowPaid] = useState(false);
  const [rememberSpeaker, setRememberSpeaker] = useState(false);
  const [size, setSize] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const musicInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setState(await requestJson<PostState>(postApi(episodeId)));
      setError("");
    } catch (err) {
      setError(errorText(err));
    }
  }, [episodeId]);

  useEffect(() => {
    // Первая загрузка: setState внутри load вызывается после ответа сервера.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const jobActive = state?.job?.status === "pending" || state?.job?.status === "running";
  const speechActive = Boolean(state?.shots.some((shot) => shot.speech.status === "queued" || shot.speech.status === "running"));
  const subtitlesActive = state?.subtitles.job?.status === "pending" || state?.subtitles.job?.status === "running";
  // Сборка ждёт распознавание речи на сервере: пока идёт — обновляем статусы кадров.
  const [building, setBuilding] = useState(false);
  useEffect(() => {
    if (!jobActive && !speechActive && !building && !subtitlesActive) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [jobActive, speechActive, building, subtitlesActive, load]);

  async function act(run: () => Promise<PostState | null>, done = "") {
    setBusy(true);
    setMessage("");
    try {
      const next = await run();
      if (next) setState(next);
      else await load();
      if (done) setMessage(done);
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  /** Запускает Kdenlive на этом компьютере с последним проектом эпизода. */
  const openProject = () =>
    act(async () => {
      const result = await requestJson<{ project: string }>(postApi(episodeId, "/open-project"), { method: "POST", body: {} });
      setMessage(t("post.opening", { project: result.project }));
      return null;
    });

  const patchLine = (id: string, patch: Record<string, number | null>) =>
    act(() => requestJson<PostState>(postApi(episodeId, "/lines"), { method: "PATCH", body: { id, ...patch } }));

  function play(line: PostLineView) {
    if (!line.clip) return;
    const { url, in: start, out: end } = line.clip;
    audio.current?.pause();
    const player = new Audio(url);
    audio.current = player;
    player.addEventListener("loadedmetadata", () => {
      player.currentTime = start;
      void player.play();
    });
    player.addEventListener("timeupdate", () => {
      if (player.currentTime >= end) player.pause();
    });
  }

  if (!state) {
    return (
      <section className="rounded-2xl border border-stone-300/70 bg-white/80 p-4 sm:p-5">
        <h2 className="font-[family-name:var(--font-display)] text-2xl text-stone-900">{t("post.title")}</h2>
        <p className="mt-2 text-sm text-stone-600">{error || t("common.loading")}</p>
      </section>
    );
  }

  const voiceable = state.characters.filter((item) => item.config);
  const chosen = selected ?? voiceable.filter((item) => item.pending > 0).map((item) => item.name);
  const chosenItems = state.characters.filter((item) => chosen.includes(item.name));
  const chosenChars = chosenItems.reduce((sum, item) => sum + item.chars, 0);
  const chosenIsolation = chosenItems.reduce((sum, item) => sum + item.isolationChars, 0);
  // «Очистить голос» — у отмеченных, у кого есть озвучка и она ещё не очищена.
  const cleanable = chosenItems.filter((item) => item.current && item.isolation.status !== "done");
  const cleanCost = cleanable.reduce((sum, item) => sum + item.isolation.cleanCost, 0);
  const sizeChoice =
    SIZES.find((item) => item.label === size) ??
    SIZES.find((item) => item.width === state.defaultSize.width && item.height === state.defaultSize.height) ??
    SIZES[0];
  const project = state.projects[state.projects.length - 1];

  async function addMusic(file: File) {
    const body = new FormData();
    body.set("file", file);
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(postApi(episodeId, "/music"), { method: "POST", body });
      const data = (await res.json()) as { error?: string; file?: string };
      if (!res.ok) throw new Error(data.error || "Не удалось добавить музыку");
      setMessage(data.file ? `Музыка добавлена: ${data.file}` : "Музыка добавлена");
      await load();
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="min-w-0 rounded-2xl border border-stone-300/70 bg-white/80 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-[family-name:var(--font-display)] text-2xl text-stone-900">{t("post.title")}</h2>
        <button type="button" onClick={() => void load()} className="text-sm text-teal-800 underline-offset-4 hover:underline">
          {t("common.refresh")}
        </button>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-4">
          <h3 className="text-base font-semibold text-stone-900">{t("post.voiceTitle")}</h3>
          <p className="mt-1 max-w-3xl text-sm text-stone-600">{t("post.voiceLead")}</p>

          {state.job ? (
            <p
              className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                state.job.status === "error"
                  ? "border-red-300 bg-red-50 text-red-950"
                  : state.job.status === "done"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                    : "border-sky-300 bg-sky-50 text-sky-950"
              }`}
            >
              {jobText(state.job, t)}
            </p>
          ) : null}

          {state.speakers.length ? (
            <>
              <h4 className="mt-4 text-sm font-medium text-stone-800">{t("post.speakers")}</h4>
              <p className="mt-1 max-w-3xl text-xs text-stone-500">{t("post.speakersHint")}</p>
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {state.speakers.map((speaker) => (
                  <li key={speaker.name} className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white/80 px-3 py-1.5 text-sm">
                    <span className="font-mono text-xs text-stone-800">{speaker.name}</span>
                    <span className="text-xs text-stone-400">{t("post.lineCount", { n: speaker.lines })}</span>
                    <span className="text-stone-400">→</span>
                    <select
                      className="rounded-md border border-stone-300 bg-white px-1.5 py-0.5 text-xs"
                      value={speaker.assigned ?? ""}
                      disabled={busy || jobActive}
                      onChange={(event) =>
                        act(() =>
                          requestJson<PostState>(postApi(episodeId, "/speakers"), {
                            method: "PUT",
                            body: { speaker: speaker.name, character: event.target.value || null, remember: rememberSpeaker },
                          }),
                        )
                      }
                    >
                      <option value="">
                        {t("post.speakerAsScript")}
                        {speaker.assigned ? "" : `: ${speaker.character}`}
                      </option>
                      {state.library.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    {speaker.assigned ? null : (
                      <span className={`text-xs ${speaker.source === "none" ? "text-amber-800" : "text-stone-400"}`}>
                        {speaker.source === "alias"
                          ? t("post.speakerFromAlias")
                          : speaker.source === "library"
                            ? t("post.speakerFromLibrary")
                            : t("post.speakerMissing")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <label className="mt-1 flex items-center gap-2 text-xs text-stone-600">
                <input type="checkbox" checked={rememberSpeaker} onChange={(event) => setRememberSpeaker(event.target.checked)} />
                {t("post.speakerRemember")}
              </label>
            </>
          ) : null}

          <h4 className="mt-4 text-sm font-medium text-stone-800">{t("post.voices")}</h4>
          {state.characters.length === 0 ? (
            <p className="mt-1 text-sm text-stone-500">{t("post.noLines")}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {state.characters.map((character) => (
                <li key={character.name} className="rounded-lg border border-stone-200 bg-white/80 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <label className="flex items-center gap-2 font-medium text-stone-900">
                      <input
                        type="checkbox"
                        disabled={!character.config || jobActive}
                        checked={chosen.includes(character.name)}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? [...chosen, character.name]
                              : chosen.filter((name) => name !== character.name),
                          )
                        }
                      />
                      {character.name}
                    </label>
                    <span className="text-xs text-stone-500">{t("post.lineCount", { n: character.lines })}</span>
                    {character.config ? (
                      <span className="font-mono text-xs text-stone-500">
                        {character.config.voice_id.slice(0, 10)}… · {character.config.model_id}
                        {character.config.text_prefix ? ` · ${character.config.text_prefix}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-800">{t("post.noVoiceFile")}</span>
                    )}
                    {character.current ? (
                      <span className="text-xs text-stone-600">
                        {t("post.version", { n: character.current.version })}
                        {character.pending ? t("post.pending", { n: character.pending }) : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-stone-500">{t("post.unvoiced")}</span>
                    )}
                    {character.current ? (
                      <span
                        title={character.isolation.error ?? undefined}
                        className={`text-xs ${
                          character.isolation.status === "done"
                            ? "text-emerald-800"
                            : character.isolation.status === "error"
                              ? "text-amber-800"
                              : "text-stone-500"
                        }`}
                      >
                        {character.isolation.status === "done"
                          ? t("post.isolated")
                          : character.isolation.status === "error"
                            ? t("post.isolateFailed")
                            : t("post.notIsolated")}
                      </span>
                    ) : null}
                    {character.versions.length > 1 ? (
                      <select
                        className="rounded-md border border-stone-300 bg-white px-1 py-0.5 text-xs"
                        value={character.current?.version ?? ""}
                        disabled={busy || jobActive}
                        title={t("post.versionTitle")}
                        onChange={(event) =>
                          act(() =>
                            requestJson<PostState>(postApi(episodeId, "/voices"), {
                              method: "POST",
                              body: { character: character.name, version: Number(event.target.value) },
                            }),
                          )
                        }
                      >
                        {character.versions.map((version) => (
                          <option key={version} value={version}>
                            v{version}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {character.config ? <span className="text-xs text-stone-500">{t("post.chars", { n: character.chars })}</span> : null}
                    <button
                      type="button"
                      className="text-xs text-teal-800 underline-offset-4 hover:underline"
                      onClick={() => setEditing(editing === character.name ? null : character.name)}
                    >
                      {character.config ? t("post.voice") : t("post.setVoice")}
                    </button>
                  </div>
                  {editing === character.name ? (
                    <VoiceForm
                      key={character.name}
                      character={character}
                      busy={busy}
                      onCancel={() => setEditing(null)}
                      onSave={(body) =>
                        act(async () => {
                          const next = await requestJson<PostState>(postApi(episodeId, "/voices"), { method: "PUT", body });
                          setEditing(null);
                          return next;
                        }, t("post.voiceSaved", { name: character.name }))
                      }
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {state.characters.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm">
              <label className="flex items-center gap-2 text-amber-950">
                <input type="checkbox" checked={allowPaid} disabled={jobActive} onChange={(event) => setAllowPaid(event.target.checked)} />
                {t("post.allowPaid")}
              </label>
              <span className="text-xs text-amber-900">
                {chosen.length
                  ? t("post.chosen", {
                      names: chosen.join(", "),
                      chars: chosenChars,
                      extra: chosenIsolation ? t("post.chosenExtra", { n: chosenIsolation }) : "",
                    })
                  : t("post.pickCharacters")}
              </span>
              <Button
                size="sm"
                disabled={!allowPaid || !chosen.length || busy || jobActive || !state.keyConfigured}
                onClick={() =>
                  act(async () => {
                    await requestJson<VoiceJob>(postApi(episodeId, "/voice-job"), {
                      method: "POST",
                      body: { characters: chosen, allowPaid: true },
                    });
                    // Разрешение — на один запуск.
                    setAllowPaid(false);
                    setSelected(null);
                    return null;
                  })
                }
              >
                {chosen.some((name) => state.characters.find((item) => item.name === name)?.current)
                  ? t("post.regenerate")
                  : t("post.speak")}
              </Button>
              {cleanable.length ? (
                <Button
                  size="sm"
                  variant="outline"
                  title={t("post.cleanTitle", { names: cleanable.map((item) => item.name).join(", "), n: cleanCost })}
                  disabled={!allowPaid || busy || jobActive || !state.keyConfigured}
                  onClick={() =>
                    act(async () => {
                      await requestJson<VoiceJob>(postApi(episodeId, "/voice-job"), {
                        method: "POST",
                        body: { characters: cleanable.map((item) => item.name), allowPaid: true, kind: "isolate" },
                      });
                      setAllowPaid(false);
                      setSelected(null);
                      return null;
                    })
                  }
                >
                  {t("post.clean", { n: cleanCost })}
                </Button>
              ) : null}
              {!state.keyConfigured ? (
                <span className="text-xs text-red-800">{t("post.noKey")}</span>
              ) : null}
            </div>
          ) : null}

          {state.shots.some((shot) => shot.hasAudio) ? (
            <>
              <h4 className="mt-4 text-sm font-medium text-stone-800">{t("post.speechTitle")}</h4>
              <p className="mt-1 text-xs text-stone-500">{t("post.speechLead", { range: t("post.speedRange") })}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {state.shots
                  .filter((shot) => shot.hasAudio)
                  .map((shot) => (
                    <span
                      key={shot.shotId}
                      title={shot.speech.error ?? shot.speech.text}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${SPEECH_STYLES[shot.speech.status]}`}
                    >
                      <span className="font-mono">{shot.shotId}</span>
                      {t(SPEECH_KEY[shot.speech.status])}
                      {shot.speech.status === "done" || shot.speech.status === "stale" || shot.speech.status === "error" ? (
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              await requestJson(postApi(episodeId, "/speech"), { method: "POST", body: { shotIds: [shot.shotId], force: true } });
                              return null;
                            })
                          }
                        >
                          {t("post.again")}
                        </button>
                      ) : null}
                    </span>
                  ))}
              </div>
            </>
          ) : null}

          {state.lines.length ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-stone-800">{t("post.lines")}</summary>
              <p className="mt-1 text-xs text-stone-500">{t("post.linesLead")}</p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.12em] text-stone-500">
                    <tr>
                      <th className="px-2 py-1">{t("post.col.n")}</th>
                      <th className="px-2 py-1">{t("post.col.shot")}</th>
                      <th className="px-2 py-1">{t("post.col.character")}</th>
                      <th className="px-2 py-1">{t("post.col.text")}</th>
                      <th className="px-2 py-1">{t("post.col.at")}</th>
                      <th className="px-2 py-1">{t("post.col.lips")}</th>
                      <th className="px-2 py-1">{t("post.col.speed")}</th>
                      <th className="px-2 py-1">{t("post.col.in")}</th>
                      <th className="px-2 py-1">{t("post.col.out")}</th>
                      <th className="px-2 py-1">{t("post.col.audio")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.lines.map((line) => (
                      <tr key={line.id} className="border-t border-stone-200 align-top">
                        <td className="px-2 py-1.5 text-xs text-stone-500">{line.order}</td>
                        <td className="px-2 py-1.5 font-mono text-xs">{line.shotId}</td>
                        <td className="px-2 py-1.5">{line.character || "—"}</td>
                        <td className="px-2 py-1.5 text-stone-800">{line.text}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <SecondsInput
                            value={line.at}
                            title={t("post.atTitle")}
                            disabled={busy}
                            onCommit={(value) => void patchLine(line.id, { at: value })}
                          />
                          {line.atManual ? (
                            <button
                              type="button"
                              className="ml-1 text-xs text-teal-800 underline-offset-4 hover:underline"
                              title={t("post.autoAt")}
                              onClick={() => void patchLine(line.id, { at: null })}
                            >
                              {t("post.auto")}
                            </button>
                          ) : (
                            <span className="ml-1 text-xs text-stone-400">{t("post.auto")}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap font-mono text-xs text-stone-600">
                          {line.window ? `${seconds(line.window.start)}–${seconds(line.window.end)}` : "—"}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <SecondsInput
                            value={line.clip?.speed ?? line.speedManual ?? 1}
                            title={t("post.speedTitle")}
                            disabled={busy || !line.clip}
                            onCommit={(value) => void patchLine(line.id, { speed: value })}
                          />
                          {line.speedManual !== null ? (
                            <button
                              type="button"
                              className="ml-1 text-xs text-teal-800 underline-offset-4 hover:underline"
                              title={t("post.autoSpeed")}
                              onClick={() => void patchLine(line.id, { speed: null })}
                            >
                              {t("post.auto")}
                            </button>
                          ) : line.clip?.fit ? (
                            <span
                              className={`ml-1 text-xs ${line.clip.fit.clamped ? "text-amber-800" : "text-stone-400"}`}
                              title={line.clip.fit.clamped ? t("post.clamped", { n: line.clip.fit.wanted }) : t("post.fit")}
                            >
                              {line.clip.fit.clamped ? t("post.needs", { n: line.clip.fit.wanted }) : t("post.lips")}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5">
                          <SecondsInput
                            value={line.trimIn}
                            title={t("post.trimIn")}
                            disabled={busy}
                            onCommit={(value) => void patchLine(line.id, { trimIn: value })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <SecondsInput
                            value={line.trimOut}
                            title={t("post.trimOut")}
                            disabled={busy}
                            onCommit={(value) => void patchLine(line.id, { trimOut: value })}
                          />
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-xs">
                          {line.clip ? (
                            <button
                              type="button"
                              className="text-teal-800 underline-offset-4 hover:underline"
                              title={`v${line.clip.version}: ${t("duration.seconds", { n: `${seconds(line.clip.in)}–${seconds(line.clip.out)}` })}`}
                              onClick={() => play(line)}
                            >
                              {t("post.play", { n: seconds(line.clip.out - line.clip.in) })}
                            </button>
                          ) : (
                            <span className={line.voice === "stale" ? "text-amber-800" : "text-stone-400"}>
                              {voiceText(t, line.voice)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

          <h4 className="mt-4 text-sm font-medium text-stone-800">{t("post.kdenlive")}</h4>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-stone-700">
              {t("post.frame")}
              <select
                className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs"
                value={sizeChoice.label}
                onChange={(event) => setSize(event.target.value)}
              >
                {SIZES.map((item) => (
                  <option key={item.label} value={item.label}>
                    {item.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-stone-500">{state.fps} fps</span>
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || jobActive}
              onClick={() =>
                act(async () => {
                  setBuilding(true);
                  try {
                    const manifest = await requestJson<{ timeline: string; kdenlive?: string; lines: unknown[] }>(
                      postApi(episodeId, "/timeline"),
                      { method: "POST", body: { width: sizeChoice.width, height: sizeChoice.height } },
                    );
                    setMessage(t("post.built", { name: (manifest.kdenlive ?? manifest.timeline).replace("timeline/", ""), n: manifest.lines.length }));
                  } finally {
                    setBuilding(false);
                  }
                  return null;
                })
              }
            >
              {building ? (speechActive ? t("post.buildingSpeech") : t("post.building")) : t("post.build")}
            </Button>
            <input
              ref={musicInput}
              type="file"
              accept=".mp3,.wav,.flac,.m4a,.ogg,.aac,audio/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void addMusic(file);
              }}
            />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => musicInput.current?.click()}>
              Добавить музыку
            </Button>
            {project ? (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void openProject()}>
                  {t("post.openKdenlive")}
                </Button>
                <a href={project.url} className="text-teal-800 underline-offset-4 hover:underline" download>
                  {t("post.download", { name: project.name })}
                </a>
              </>
            ) : null}
          </div>
          {project ? (
            <p className="mt-1 break-all font-mono text-xs text-stone-600" title={t("post.openPath")}>
              {project.path}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-stone-500">
            {t("post.kdenliveHelp")}
            {state.projects.length > 1 ? t("post.older", { names: state.projects.slice(0, -1).map((item) => item.name).join(", ") }) : ""}
          </p>
          <p className="mt-1 text-xs text-stone-600">
            {state.music.files.length ? (
              <>
                {t("post.musicOn", { files: state.music.files.join(", ") })}
              </>
            ) : (
              <>
                {t("post.musicOff", { dir: state.music.dir })}
              </>
            )}
          </p>
          {state.manifest && (state.manifest.warnings.length || state.manifest.skipped.length) ? (
            <ul className="mt-2 space-y-0.5 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-950">
              {state.manifest.skipped.map((item) => (
                <li key={item.id}>
                  {t("post.skip", { id: item.id, reason: item.reason })}
                </li>
              ))}
              {state.manifest.warnings.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}

          {message ? <p className="mt-3 text-sm text-stone-700">{message}</p> : null}
        </div>

        <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-4">
          <h3 className="text-base font-semibold text-stone-900">{t("post.subs")}</h3>
          <p className="mt-1 max-w-3xl text-sm text-stone-600">{t("post.subsLead", { style: state.subtitles.styleFile })}</p>
          <p className="mt-1 text-xs text-amber-900">{t("post.subsWarn")}</p>
          {state.subtitles.project ? (
            <p className="mt-1 break-all font-mono text-xs text-stone-600">{t("post.project", { name: state.subtitles.project })}</p>
          ) : null}
          {!state.subtitles.hasStyle ? (
            <p className="mt-1 text-xs text-amber-800">{t("post.noStyle")}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={busy || subtitlesActive || !state.subtitles.project}
              onClick={() =>
                act(async () => {
                  await requestJson(postApi(episodeId, "/subtitles"), { method: "POST", body: {} });
                  return null;
                })
              }
            >
              {subtitlesActive ? t("post.subbing") : t("post.addSubs")}
            </Button>
            {state.subtitles.project ? (
              <Button size="sm" variant="outline" disabled={busy || subtitlesActive} onClick={() => void openProject()}>
                  {t("post.openKdenlive")}
              </Button>
            ) : null}
            {state.subtitles.renders.length ? (
              <a
                href={state.subtitles.renders[state.subtitles.renders.length - 1].url}
                className="text-sm text-teal-800 underline-offset-4 hover:underline"
                download
              >
                {t("post.download", { name: state.subtitles.renders[state.subtitles.renders.length - 1].name })}
              </a>
            ) : null}
          </div>
          {state.subtitles.job ? (
            <p
              className={`mt-2 rounded-lg border px-3 py-2 text-sm ${
                state.subtitles.job.status === "error"
                  ? "border-red-300 bg-red-50 text-red-950"
                  : state.subtitles.job.status === "done"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                    : "border-sky-300 bg-sky-50 text-sky-950"
              }`}
            >
              {state.subtitles.job.status === "error"
                ? t("post.subFailed", { error: state.subtitles.job.error ?? t("post.subErrorWord") })
                : state.subtitles.job.status === "done"
                  ? `${t("post.subDone", { n: state.subtitles.job.words ?? 0 })}${
                      state.subtitles.job.lines
                        ? t(state.subtitles.job.linesFrom === "manifest" ? "post.subLinesBuild" : "post.subLinesProject", { n: state.subtitles.job.lines })
                        : ""
                    }${state.subtitles.job.cut?.length ? t("post.subCut", { words: state.subtitles.job.cut.join(" ") }) : ""}${
                      state.subtitles.job.extra?.length ? t("post.subExtra", { n: state.subtitles.job.extra.length }) : ""
                    }${
                      state.subtitles.job.missing?.length ? t("post.subMissing", { words: state.subtitles.job.missing.join(", ") }) : ""
                    }${state.subtitles.job.music?.length ? t("post.subMusic", { names: state.subtitles.job.music.join(", ") }) : ""}${
                      state.subtitles.job.musicNote ? t("post.subMusicNote", { note: state.subtitles.job.musicNote }) : ""
                    }${t("post.subReopen", { backup: state.subtitles.job.backup ?? "—" })}`
                  : t("post.subRunning", { progress: state.subtitles.job.progress ?? t("post.subStart") })}
            </p>
          ) : null}
          {state.subtitles.renders.length ? (
            <p className="mt-1 break-all font-mono text-xs text-stone-500">
              {state.subtitles.renders[state.subtitles.renders.length - 1].path}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
