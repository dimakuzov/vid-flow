"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, requestJson } from "@/components/stage/api";
import { Button } from "@/components/ui/button";
import type { PostCharacterView, PostLineView, PostState } from "@/lib/post/state";
import type { VoiceJob } from "@/lib/post/voice-job";

/*
 * Секция «Пост» под таблицей кадров (docs/contracts/post.md): озвучка реплик в ElevenLabs
 * и таймлайн для DaVinci Resolve. Субтитры — следующая часть.
 */

const SIZES = [
  { label: "720×1280", width: 720, height: 1280 },
  { label: "768×1344", width: 768, height: 1344 },
  { label: "1080×1920", width: 1080, height: 1920 },
];

const SPEED_RANGE = "0.8× до 1.35×";

type SpeechStatusView = PostState["shots"][number]["speech"]["status"];

const SPEECH_LABELS: Record<SpeechStatusView, string> = {
  none: "не распознан",
  queued: "в очереди",
  running: "распознаётся",
  done: "готово",
  error: "ошибка",
  stale: "финал заменён",
};

const SPEECH_STYLES: Record<SpeechStatusView, string> = {
  none: "border-stone-300 text-stone-500",
  queued: "border-sky-300 bg-sky-50 text-sky-900",
  running: "border-sky-300 bg-sky-50 text-sky-900",
  done: "border-emerald-300 bg-emerald-50 text-emerald-900",
  error: "border-red-300 bg-red-50 text-red-900",
  stale: "border-amber-300 bg-amber-50 text-amber-900",
};

const VOICE_LABELS: Record<PostLineView["voice"], string> = {
  ok: "",
  "no-voice": "нет озвучки",
  stale: "текст изменился — перегенерировать",
  "no-character": "нет имени в speech.md",
};

function postApi(episodeId: string, tail = ""): string {
  return `/api/episodes/${encodeURIComponent(episodeId)}/post${tail}`;
}

function seconds(value: number): string {
  return `${Math.round(value * 100) / 100}`;
}

function jobText(job: VoiceJob): string {
  const what = job.kind === "isolate" ? "Очистка голоса" : "Озвучка";
  if (job.status === "pending") return `${what} поставлена…`;
  if (job.status === "running") return `${what} идёт: ${job.progress ?? "запросы в ElevenLabs"}`;
  if (job.status === "error") return `${what} не удалась: ${job.error ?? "ошибка"}`;
  const versions = job.results.map((item) => `${item.character} v${item.version}`).join(", ");
  const failed = job.results.filter((item) => item.isolation === "error");
  const cost = job.kind === "isolate" ? `≈${job.isolationChars ?? 0} кредитов` : `${job.chars} символов${job.isolationChars ? ` + ≈${job.isolationChars} за очистку` : ""}`;
  const done = `${job.kind === "isolate" ? "Очищено" : "Озвучено"}: ${versions} (${cost})`;
  return failed.length
    ? `${done}. Очистка не удалась у ${failed.map((item) => `${item.character} (${item.isolationError ?? "ошибка"})`).join(", ")} — в проекте исходный звук`
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
        voice_id (из ElevenLabs → Voices)
        <input className={`${field} font-mono`} value={voiceId} onChange={(event) => setVoiceId(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2">
        model_id
        <input className={`${field} font-mono`} value={modelId} onChange={(event) => setModelId(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
        Тег перед каждой фразой (аудиотег v3; в текст реплик и субтитры не попадает; пусто — без тега)
        <input className={`${field} font-mono`} value={prefix} onChange={(event) => setPrefix(event.target.value)} />
      </label>
      <label className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
        <input type="checkbox" checked={isolate} onChange={(event) => setIsolate(event.target.checked)} />
        Очищать голос через Voice Isolator после озвучки (убирает шум и треск; ≈1000 кредитов за минуту звука)
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
        seed (тот же голос при повторе)
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
          Сохранить голос
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
        <span className="text-stone-500">Пишется в data/characters/{character.name}/voice.json, общий для всех эпизодов.</span>
      </div>
    </div>
  );
}

export function PostPanel({ episodeId }: { episodeId: string }) {
  const [state, setState] = useState<PostState | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [allowPaid, setAllowPaid] = useState(false);
  const [size, setSize] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

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
        <h2 className="font-[family-name:var(--font-display)] text-2xl text-stone-900">Пост</h2>
        <p className="mt-2 text-sm text-stone-600">{error || "Загрузка…"}</p>
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
  const latest = state.timelines[state.timelines.length - 1];
  const project = state.projects[state.projects.length - 1];

  return (
    <section className="min-w-0 rounded-2xl border border-stone-300/70 bg-white/80 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-[family-name:var(--font-display)] text-2xl text-stone-900">Пост</h2>
        <button type="button" onClick={() => void load()} className="text-sm text-teal-800 underline-offset-4 hover:underline">
          Обновить
        </button>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-4">
          <h3 className="text-base font-semibold text-stone-900">Озвучка и проект DaVinci</h3>
          <p className="mt-1 max-w-3xl text-sm text-stone-600">
            Реплики берутся из «Реплик» кадров (speech.md). Один файл озвучки на персонажа со всеми его репликами —
            голос не меняется между фразами. В таймлайне каждая реплика — отрезок этого файла, край клипа в Resolve можно потянуть.
          </p>

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
              {jobText(state.job)}
            </p>
          ) : null}

          <h4 className="mt-4 text-sm font-medium text-stone-800">Голоса</h4>
          {state.characters.length === 0 ? (
            <p className="mt-1 text-sm text-stone-500">Реплик нет: заполните «Реплики» на этапах превью или финала кадров.</p>
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
                    <span className="text-xs text-stone-500">реплик: {character.lines}</span>
                    {character.config ? (
                      <span className="font-mono text-xs text-stone-500">
                        {character.config.voice_id.slice(0, 10)}… · {character.config.model_id}
                        {character.config.text_prefix ? ` · ${character.config.text_prefix}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-800">нет voice.json</span>
                    )}
                    {character.current ? (
                      <span className="text-xs text-stone-600">
                        озвучка v{character.current.version}
                        {character.pending ? `, без актуальной озвучки: ${character.pending}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-stone-500">не озвучен</span>
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
                          ? "очищен"
                          : character.isolation.status === "error"
                            ? "очистка не удалась"
                            : "не очищен"}
                      </span>
                    ) : null}
                    {character.versions.length > 1 ? (
                      <select
                        className="rounded-md border border-stone-300 bg-white px-1 py-0.5 text-xs"
                        value={character.current?.version ?? ""}
                        disabled={busy || jobActive}
                        title="Какая версия озвучки идёт в таймлайн"
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
                    {character.config ? <span className="text-xs text-stone-500">{character.chars} симв.</span> : null}
                    <button
                      type="button"
                      className="text-xs text-teal-800 underline-offset-4 hover:underline"
                      onClick={() => setEditing(editing === character.name ? null : character.name)}
                    >
                      {character.config ? "Голос" : "Задать голос"}
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
                        }, `Голос ${character.name} сохранён`)
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
                Разрешить платную отправку в ElevenLabs
              </label>
              <span className="text-xs text-amber-900">
                {chosen.length
                  ? `${chosen.join(", ")}: ${chosenChars} символов${chosenIsolation ? ` + ≈${chosenIsolation} кредитов на очистку` : ""}`
                  : "Отметьте персонажей"}
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
                  ? "Перегенерировать"
                  : "Озвучить"}
              </Button>
              {cleanable.length ? (
                <Button
                  size="sm"
                  variant="outline"
                  title={`Voice Isolator по текущей озвучке: ${cleanable.map((item) => item.name).join(", ")}, ≈${cleanCost} кредитов`}
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
                  Очистить голос (≈{cleanCost})
                </Button>
              ) : null}
              {!state.keyConfigured ? (
                <span className="text-xs text-red-800">Нет ELEVENLABS_API_KEY в .env.local — впишите ключ и перезапустите доску.</span>
              ) : null}
            </div>
          ) : null}

          {state.shots.some((shot) => shot.hasAudio) ? (
            <>
              <h4 className="mt-4 text-sm font-medium text-stone-800">Речь в кадрах — под губы</h4>
              <p className="mt-1 text-xs text-stone-500">
                «Собрать проект» сначала распознаёт (Whisper, локальный ComfyUI, бесплатно), где в финале кадра звучит каждая
                реплика. Озвучка ставится на это место и ускоряется или замедляется до длины речи в видео (от {SPEED_RANGE},
                тон не меняется). Уже распознанные кадры повторно не распознаются, пока не заменён финал.
              </p>
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
                      {SPEECH_LABELS[shot.speech.status]}
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
                          заново
                        </button>
                      ) : null}
                    </span>
                  ))}
              </div>
            </>
          ) : null}

          {state.lines.length ? (
            <>
              <h4 className="mt-4 text-sm font-medium text-stone-800">Реплики</h4>
              <p className="mt-1 text-xs text-stone-500">
                «Место» — секунда от начала кадра, где начинается речь: по губам (если речь распознана), иначе по паузам или подряд.
                «Губы» — где реплику произносят в видео. «Скорость» — во сколько раз быстрее звучит клип (авто — под губы).
                «Начало» и «Конец» — сдвиг границ отрезка, секунды (минус — раньше). Правки переживают перегенерацию, пока текст реплики не изменился.
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.12em] text-stone-500">
                    <tr>
                      <th className="px-2 py-1">№</th>
                      <th className="px-2 py-1">Кадр</th>
                      <th className="px-2 py-1">Персонаж</th>
                      <th className="px-2 py-1">Текст</th>
                      <th className="px-2 py-1">Место</th>
                      <th className="px-2 py-1">Губы</th>
                      <th className="px-2 py-1">Скорость</th>
                      <th className="px-2 py-1">Начало</th>
                      <th className="px-2 py-1">Конец</th>
                      <th className="px-2 py-1">Звук</th>
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
                            title="Секунды от начала кадра"
                            disabled={busy}
                            onCommit={(value) => void patchLine(line.id, { at: value })}
                          />
                          {line.atManual ? (
                            <button
                              type="button"
                              className="ml-1 text-xs text-teal-800 underline-offset-4 hover:underline"
                              title="Вернуть авто-место"
                              onClick={() => void patchLine(line.id, { at: null })}
                            >
                              авто
                            </button>
                          ) : (
                            <span className="ml-1 text-xs text-stone-400">авто</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap font-mono text-xs text-stone-600">
                          {line.window ? `${seconds(line.window.start)}–${seconds(line.window.end)}` : "—"}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <SecondsInput
                            value={line.clip?.speed ?? line.speedManual ?? 1}
                            title="Во сколько раз быстрее (1 — как есть)"
                            disabled={busy || !line.clip}
                            onCommit={(value) => void patchLine(line.id, { speed: value })}
                          />
                          {line.speedManual !== null ? (
                            <button
                              type="button"
                              className="ml-1 text-xs text-teal-800 underline-offset-4 hover:underline"
                              title="Вернуть авто-скорость"
                              onClick={() => void patchLine(line.id, { speed: null })}
                            >
                              авто
                            </button>
                          ) : line.clip?.fit ? (
                            <span
                              className={`ml-1 text-xs ${line.clip.fit.clamped ? "text-amber-800" : "text-stone-400"}`}
                              title={line.clip.fit.clamped ? `Нужно ${line.clip.fit.wanted}× — упёрлось в предел` : "Подогнано под губы"}
                            >
                              {line.clip.fit.clamped ? `нужно ${line.clip.fit.wanted}×` : "губы"}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5">
                          <SecondsInput
                            value={line.trimIn}
                            title="Сдвиг начала отрезка, секунды"
                            disabled={busy}
                            onCommit={(value) => void patchLine(line.id, { trimIn: value })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <SecondsInput
                            value={line.trimOut}
                            title="Сдвиг конца отрезка, секунды"
                            disabled={busy}
                            onCommit={(value) => void patchLine(line.id, { trimOut: value })}
                          />
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-xs">
                          {line.clip ? (
                            <button
                              type="button"
                              className="text-teal-800 underline-offset-4 hover:underline"
                              title={`v${line.clip.version}: ${seconds(line.clip.in)}–${seconds(line.clip.out)} с`}
                              onClick={() => play(line)}
                            >
                              ▶ {seconds(line.clip.out - line.clip.in)} с
                            </button>
                          ) : (
                            <span className={line.voice === "stale" ? "text-amber-800" : "text-stone-400"}>
                              {VOICE_LABELS[line.voice]}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          <h4 className="mt-4 text-sm font-medium text-stone-800">Проект Kdenlive</h4>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-stone-700">
              Кадр
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
                    setMessage(`Собран ${(manifest.kdenlive ?? manifest.timeline).replace("timeline/", "")}: реплик ${manifest.lines.length}`);
                  } finally {
                    setBuilding(false);
                  }
                  return null;
                })
              }
            >
              {building ? (speechActive ? "Распознаю речь…" : "Собираю…") : "Собрать проект"}
            </Button>
            {project ? (
              <a href={project.url} className="text-teal-800 underline-offset-4 hover:underline" download>
                Скачать {project.name}
              </a>
            ) : null}
            {latest ? (
              <a href={latest.url} className="text-xs text-stone-500 underline-offset-4 hover:underline" download>
                FCPXML для Resolve
              </a>
            ) : null}
          </div>
          {project ? (
            <p className="mt-1 break-all font-mono text-xs text-stone-600" title="Откройте этот файл в Kdenlive: File → Open">
              {project.path}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-stone-500">
            Kdenlive: File → Open, выбрать .kdenlive (лучше по пути выше — файлы озвучки и кадров берутся оттуда). Дорожки: «Кадры» — финалы
            подряд; дорожка на персонажа; внизу «Звук финалов (выкл.)» для сверки с губами. Бесплатно, локально.
            {state.projects.length > 1 ? ` Прошлые версии: ${state.projects.slice(0, -1).map((item) => item.name).join(", ")}.` : ""}
          </p>
          <p className="mt-1 text-xs text-stone-600">
            {state.music.files.length ? (
              <>
                Музыка: {state.music.files.join(", ")} — нижняя дорожка «Музыка», по кругу до конца, тише под репликами
                (эффект Volume, правится в Kdenlive). Войдёт в следующую сборку.
              </>
            ) : (
              <>
                Музыка: положите файл (mp3, wav, flac, m4a, ogg) в <span className="break-all font-mono">{state.music.dir}</span> — следующая
                сборка добавит её дорожкой «Музыка».
              </>
            )}
          </p>
          {state.manifest && (state.manifest.warnings.length || state.manifest.skipped.length) ? (
            <ul className="mt-2 space-y-0.5 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-950">
              {state.manifest.skipped.map((item) => (
                <li key={item.id}>
                  {item.id}: не в таймлайне — {item.reason}
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
          <h3 className="text-base font-semibold text-stone-900">Субтитры и рендер</h3>
          <p className="mt-1 max-w-3xl text-sm text-stone-600">
            Берёт последний проект Kdenlive (как вы его отредактировали), достаёт из него звук, Whisper находит каждое слово,
            субтитры — по одному слову, текст из реплик, стиль из <span className="break-all font-mono text-xs">{state.subtitles.styleFile}</span>.
            Субтитры вставляются в проект (копия до правки сохраняется рядом), потом рендер: 720×1280, 24 fps, H.264 1.6 Мбит/с. Бесплатно, локально.
          </p>
          <p className="mt-1 text-xs text-amber-900">
            Перед запуском сохраните проект в Kdenlive и закройте его — иначе Kdenlive при следующем сохранении затрёт субтитры.
          </p>
          {state.subtitles.project ? (
            <p className="mt-1 break-all font-mono text-xs text-stone-600">Проект: {state.subtitles.project}</p>
          ) : null}
          {!state.subtitles.hasStyle ? (
            <p className="mt-1 text-xs text-amber-800">Нет файла стиля — субтитры будут простым белым шрифтом.</p>
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
              {subtitlesActive ? "Делаю субтитры…" : "Добавить субтитры"}
            </Button>
            {state.subtitles.renders.length ? (
              <a
                href={state.subtitles.renders[state.subtitles.renders.length - 1].url}
                className="text-sm text-teal-800 underline-offset-4 hover:underline"
                download
              >
                Скачать {state.subtitles.renders[state.subtitles.renders.length - 1].name}
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
                ? `Не получилось: ${state.subtitles.job.error ?? "ошибка"}`
                : state.subtitles.job.status === "done"
                  ? `Готово: ${state.subtitles.job.words ?? 0} слов в субтитрах${
                      state.subtitles.job.missing?.length ? ` (Whisper не услышал: ${state.subtitles.job.missing.join(", ")} — время поставлено между соседями)` : ""
                    }. Проект обновлён — откройте его в Kdenlive заново. Копия до правки: ${state.subtitles.job.backup ?? "—"}.`
                  : `Идёт: ${state.subtitles.job.progress ?? "начало"}`}
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
