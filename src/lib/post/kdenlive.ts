import crypto from "crypto";
import fs from "fs";
import path from "path";
import { episodeRoot } from "../series/paths";
import { probeMedia } from "./ffmpeg";
import { MUSIC_TRACK_NAME } from "./music";
import { postDir, TIMELINE_FPS } from "./paths";
import type { Manifest } from "./timeline";

/*
 * Проект Kdenlive (`.kdenlive`, MLT XML, формат документа 1.1 — Kdenlive 23.04+) по манифесту сборки.
 * Открывается в Kdenlive как обычный проект, без импорта. Раскладка та же, что в FCPXML:
 *   V1 — финалы кадров подряд (без звука);
 *   A1… — дорожка на персонажа, реплика — отрезок длинного файла озвучки;
 *   нижняя A — свой звук финалов H3/HeyGen, дорожка выключена (сверка с губами).
 * Образец формата — tests/dataset/*.kdenlive в репозитории Kdenlive.
 */

const KDENLIVE_VERSION = "26.08.1";
const MLT_VERSION = "7.41.0";

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function prop(name: string, value: string | number): string {
  return `<property name="${name}">${xml(String(value))}</property>`;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

const frames = (seconds: number) => Math.round(seconds * TIMELINE_FPS);

interface Source {
  file: string;
  name: string;
  binId: string;
  kdenliveId: number;
  length: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

interface Clip {
  /** Кадр таймлайна. */
  start: number;
  /** Вход и длина в кадрах источника (без скорости). */
  in: number;
  length: number;
  source: Source;
  /** Скорость; ≠1 — клип через `timewarp` с сохранением тона. */
  speed: number;
}

/** Длина клипа на таймлайне и его вход в кадрах продюсера (у `timewarp` кадры уже со скоростью). */
function timelineSpan(clip: Clip): { in: number; length: number } {
  if (clip.speed === 1) return { in: clip.in, length: clip.length };
  return { in: Math.round(clip.in / clip.speed), length: Math.max(1, Math.round(clip.length / clip.speed)) };
}

/** Нарастание и затухание звука реплики, кадров: срез посреди волны иначе щёлкает. */
export const VOICE_FADE_FRAMES = 2;

/**
 * Эффекты Kdenlive «Fade in» / «Fade out» на клипе (фильтр `volume`, data/kdenlive/effects/fadein.xml):
 * `in`/`out` фильтра — кадры клипа, громкость от `gain` до `end`.
 */
function fadeFilters(id: string, inPoint: number, out: number, frames: number): string {
  const length = out - inPoint + 1;
  const fade = Math.min(frames, Math.floor(length / 2));
  if (fade < 1) return "";
  const filter = (kind: "fadein" | "fadeout", from: number, to: number, gain: number, end: number) => `
   <filter id="${id}_${kind}" in="${from}" out="${to}">
    ${prop("window", 75)}
    ${prop("max_gain", "20dB")}
    ${prop("mlt_service", "volume")}
    ${prop("kdenlive_id", kind)}
    ${prop("gain", gain)}
    ${prop("end", end)}
    ${prop("kdenlive:collapsed", 0)}
   </filter>`;
  return filter("fadein", inPoint, inPoint + fade - 1, 0, 1) + filter("fadeout", out - fade + 1, out, 1, 0);
}

/** Плейлист дорожки: пустоты `blank` и клипы по порядку. Наезд обрезает конец предыдущего клипа. */
function playlistXml(
  id: string,
  clips: Clip[],
  producerOf: (clip: Clip) => string,
  audio: boolean,
  fadeFrames = 0,
): string {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const body: string[] = [];
  let cursor = 0;
  sorted.forEach((clip, index) => {
    const next = sorted[index + 1];
    const span = timelineSpan(clip);
    const length = Math.max(1, next ? Math.min(span.length, next.start - clip.start) : span.length);
    if (clip.start > cursor) body.push(`  <blank length="${clip.start - cursor}"/>`);
    const start = Math.max(clip.start, cursor);
    const inPoint = span.in + (start - clip.start);
    const out = inPoint + Math.max(1, length - (start - clip.start)) - 1;
    const fades = fadeFrames ? fadeFilters(`${id}_${index}`, inPoint, out, fadeFrames) : "";
    body.push(
      `  <entry producer="${producerOf(clip)}" in="${inPoint}" out="${out}">\n   ${prop("kdenlive:id", clip.source.kdenliveId)}${fades}\n  </entry>`,
    );
    cursor = start + (out - inPoint + 1);
  });
  return `<playlist id="${id}">\n${audio ? `  ${prop("kdenlive:audio_track", 1)}\n` : ""}${body.join("\n")}${body.length ? "\n" : ""}</playlist>`;
}

const AUDIO_TRACK_FILTERS = (prefix: string) => `  <filter id="${prefix}_volume">
   ${prop("window", 75)}
   ${prop("max_gain", "20dB")}
   ${prop("mlt_service", "volume")}
   ${prop("internal_added", 237)}
   ${prop("disable", 1)}
  </filter>
  <filter id="${prefix}_panner">
   ${prop("channel", -1)}
   ${prop("mlt_service", "panner")}
   ${prop("internal_added", 237)}
   ${prop("start", 0.5)}
   ${prop("disable", 1)}
  </filter>`;

/** Пишет `{name}.kdenlive` рядом с FCPXML. Ответ — путь от папки поста. */
export async function writeKdenliveProject(episodeId: string, manifest: Manifest, timelineDirPath: string, name: string): Promise<string> {
  const episodeDir = episodeRoot(episodeId);
  const postRoot = postDir(episodeId);
  const sources = new Map<string, Source>();
  let nextId = 2;
  const source = async (file: string, label: string): Promise<Source> => {
    const existing = sources.get(file);
    if (existing) return existing;
    const probe = await probeMedia(file);
    const item: Source = {
      file,
      name: label,
      binId: `chain${sources.size}`,
      kdenliveId: nextId++,
      length: Math.max(1, Math.ceil(probe.duration * TIMELINE_FPS)),
      hasVideo: probe.hasVideo,
      hasAudio: probe.hasAudio,
    };
    sources.set(file, item);
    return item;
  };

  const videoClips: Clip[] = [];
  const finalAudioClips: Clip[] = [];
  for (const shot of manifest.shots) {
    if (!shot.file) continue;
    const src = await source(path.join(episodeDir, shot.file), shot.shotId);
    const clip = { start: frames(shot.start), in: 0, length: frames(shot.duration), source: src, speed: 1 };
    videoClips.push(clip);
    if (shot.hasAudio && src.hasAudio) finalAudioClips.push(clip);
  }
  const characterClips = new Map<string, Clip[]>(manifest.characters.map((item) => [item.name, []]));
  for (const line of manifest.lines) {
    const src = await source(path.join(postRoot, line.source), `${line.character} озвучка`);
    characterClips.get(line.character)?.push({
      start: frames(line.timelineStart),
      in: frames(line.sourceIn),
      length: Math.max(1, frames(line.sourceOut) - frames(line.sourceIn)),
      source: src,
      speed: line.speed ?? 1,
    });
  }
  const totalFrames = Math.max(1, frames(manifest.duration));

  // Медиа в корзине проекта и копии для дорожек (видео без звука, звук без картинки).
  const chainXml = (id: string, src: Source, mode: "bin" | "video" | "audio") => {
    const lines = [
      prop("length", src.length),
      prop("eof", "pause"),
      prop("resource", src.file.split(path.sep).join("/")),
      prop("mlt_service", "avformat-novalidate"),
      prop("seekable", 1),
      prop("audio_index", src.hasAudio ? (src.hasVideo ? 1 : 0) : -1),
      prop("video_index", src.hasVideo ? 0 : -1),
      prop("kdenlive:clipname", src.name),
      prop("kdenlive:folderid", -1),
      prop("kdenlive:id", src.kdenliveId),
      prop("mute_on_pause", 0),
    ];
    if (mode === "video") lines.push(prop("set.test_audio", 1), prop("set.test_image", 0));
    if (mode === "audio") lines.push(prop("set.test_audio", 0), prop("set.test_image", 1));
    return `<chain id="${id}" out="${src.length - 1}">\n  ${lines.join("\n  ")}\n</chain>`;
  };
  const used = { video: new Set<Source>(), audio: new Set<Source>() };
  const warped = new Map<string, { src: Source; speed: number }>();
  const videoProducer = (clip: Clip) => (used.video.add(clip.source), `${clip.source.binId}_video`);
  const audioProducer = (clip: Clip) => {
    if (clip.speed === 1) {
      used.audio.add(clip.source);
      return `${clip.source.binId}_audio`;
    }
    const id = `${clip.source.binId}_tw${Math.round(clip.speed * 100)}`;
    warped.set(id, { src: clip.source, speed: clip.speed });
    return id;
  };
  // Ускоренный (замедленный) звук без смены тона: MLT `timewarp`, `warp_pitch=1` — как «Изменить скорость»
  // с компенсацией тона в Kdenlive. Кадры продюсера — уже со скоростью.
  const timewarpXml = (id: string, src: Source, speed: number) => {
    const file = src.file.split(path.sep).join("/");
    const length = Math.max(1, Math.ceil(src.length / speed));
    return `<producer id="${id}" in="0" out="${length - 1}">
  ${prop("length", length)}
  ${prop("eof", "pause")}
  ${prop("resource", `${speed}:${file}`)}
  ${prop("mlt_service", "timewarp")}
  ${prop("warp_speed", speed)}
  ${prop("warp_resource", file)}
  ${prop("warp_pitch", 1)}
  ${prop("seekable", 1)}
  ${prop("audio_index", src.hasVideo ? 1 : 0)}
  ${prop("video_index", src.hasVideo ? 0 : -1)}
  ${prop("kdenlive:clipname", src.name)}
  ${prop("kdenlive:folderid", -1)}
  ${prop("kdenlive:id", src.kdenliveId)}
  ${prop("set.test_audio", 0)}
  ${prop("set.test_image", 1)}
</producer>`;
  };

  // Дорожки снизу вверх: «Музыка» (пустая — её заполняет «Добавить субтитры» по речи отредактированного
  // проекта; заранее, чтобы потом не сдвигать номера дорожек), звук финалов, персонажи, видео.
  const tracks: { id: string; name: string; audio: boolean; muted: boolean; playlist: string; filters?: string }[] = [
    { id: "tractor_music", name: MUSIC_TRACK_NAME, audio: true, muted: false, playlist: playlistXml("playlist_music", [], audioProducer, true) },
  ];
  if (finalAudioClips.length) {
    tracks.push({
      id: "tractor_final_audio",
      name: "Звук финалов (выкл.)",
      audio: true,
      muted: true,
      playlist: playlistXml("playlist_final_audio", finalAudioClips, audioProducer, true),
    });
  }
  [...manifest.characters].reverse().forEach((character, index) => {
    tracks.push({
      id: `tractor_voice${index}`,
      name: character.name,
      audio: true,
      muted: false,
      playlist: playlistXml(
        `playlist_voice${index}`,
        characterClips.get(character.name) ?? [],
        audioProducer,
        true,
        VOICE_FADE_FRAMES,
      ),
    });
  });
  tracks.push({
    id: "tractor_video",
    name: "Кадры",
    audio: false,
    muted: false,
    playlist: playlistXml("playlist_video", videoClips, videoProducer, false),
  });

  const trackXml = tracks.map((track) => {
    const hide = track.audio ? (track.muted ? "both" : "video") : "audio";
    const spare = track.playlist.match(/^<playlist id="([^"]+)"/)![1] + "_mix";
    return `${track.playlist}
<playlist id="${spare}">${track.audio ? `\n  ${prop("kdenlive:audio_track", 1)}\n` : ""}</playlist>
<tractor id="${track.id}" in="0" out="${totalFrames - 1}">
  ${track.audio ? `${prop("kdenlive:audio_track", 1)}\n  ` : ""}${prop("kdenlive:track_name", track.name)}
  ${prop("kdenlive:trackheight", 67)}
  ${prop("kdenlive:timeline_active", 1)}
  ${prop("kdenlive:collapsed", 0)}
  <track hide="${hide}" producer="${track.playlist.match(/^<playlist id="([^"]+)"/)![1]}"/>
  <track hide="${hide}" producer="${spare}"/>
${track.audio ? AUDIO_TRACK_FILTERS(track.id) : ""}${track.filters ? `\n${track.filters}` : ""}
</tractor>`;
  });

  const uuid = `{${crypto.randomUUID()}}`;
  const sequenceId = nextId++;
  const audioCount = tracks.filter((track) => track.audio).length;
  const transitions = tracks.map((track, index) =>
    track.audio
      ? `  <transition id="transition_mix${index}">
   ${prop("a_track", 0)}
   ${prop("b_track", index + 1)}
   ${prop("mlt_service", "mix")}
   ${prop("kdenlive_id", "mix")}
   ${prop("internal_added", 237)}
   ${prop("always_active", 1)}
   ${prop("accepts_blanks", 1)}
   ${prop("sum", 1)}
  </transition>`
      : `  <transition id="transition_blend${index}">
   ${prop("a_track", 0)}
   ${prop("b_track", index + 1)}
   ${prop("compositing", 0)}
   ${prop("distort", 0)}
   ${prop("rotate_center", 0)}
   ${prop("mlt_service", "qtblend")}
   ${prop("kdenlive_id", "qtblend")}
   ${prop("internal_added", 237)}
   ${prop("always_active", 1)}
  </transition>`,
  );

  const { width, height } = manifest;
  const divisor = gcd(width, height);
  const all = [...sources.values()];
  const body = `<?xml version='1.0' encoding='utf-8'?>
<mlt LC_NUMERIC="C" producer="main_bin" version="${MLT_VERSION}" root="">
 <profile description="${width}x${height} ${TIMELINE_FPS} fps" width="${width}" height="${height}" progressive="1" sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="${width / divisor}" display_aspect_den="${height / divisor}" frame_rate_num="${TIMELINE_FPS}" frame_rate_den="1" colorspace="709"/>
${all.map((src) => chainXml(src.binId, src, "bin")).join("\n")}
${[...used.video].map((src) => chainXml(`${src.binId}_video`, src, "video")).join("\n")}
${[...used.audio].map((src) => chainXml(`${src.binId}_audio`, src, "audio")).join("\n")}
${[...warped.entries()].map(([id, item]) => timewarpXml(id, item.src, item.speed)).join("\n")}
<producer id="black_track" in="0" out="${totalFrames - 1}">
  ${prop("length", 2147483647)}
  ${prop("eof", "continue")}
  ${prop("resource", "black")}
  ${prop("aspect_ratio", 1)}
  ${prop("mlt_service", "color")}
  ${prop("kdenlive:playlistid", "black_track")}
  ${prop("mlt_image_format", "rgba")}
  ${prop("set.test_audio", 0)}
</producer>
${trackXml.join("\n")}
<tractor id="${uuid}" in="0" out="${totalFrames - 1}">
  ${prop("kdenlive:uuid", uuid)}
  ${prop("kdenlive:clipname", `${manifest.episodeId} ${name}`)}
  ${prop("kdenlive:sequenceproperties.hasAudio", 1)}
  ${prop("kdenlive:sequenceproperties.hasVideo", 1)}
  ${prop("kdenlive:sequenceproperties.activeTrack", tracks.length - 1)}
  ${prop("kdenlive:sequenceproperties.tracksCount", tracks.length)}
  ${prop("kdenlive:sequenceproperties.tracks", tracks.length)}
  ${prop("kdenlive:sequenceproperties.documentuuid", uuid)}
  ${prop("kdenlive:sequenceproperties.audioTarget", Math.max(0, audioCount - 1))}
  ${prop("kdenlive:sequenceproperties.videoTarget", tracks.length - 1)}
  ${prop("kdenlive:sequenceproperties.verticalzoom", 1)}
  ${prop("kdenlive:sequenceproperties.zonein", 0)}
  ${prop("kdenlive:sequenceproperties.zoneout", Math.min(totalFrames, 75))}
  ${prop("kdenlive:sequenceproperties.zoom", 8)}
  ${prop("kdenlive:sequenceproperties.groups", "[\n]\n")}
  ${prop("kdenlive:sequenceproperties.guides", "[\n]\n")}
  ${prop("kdenlive:sequenceproperties.position", 0)}
  ${prop("kdenlive:sequenceproperties.scrollPos", 0)}
  ${prop("kdenlive:sequenceproperties.disablepreview", 0)}
  ${prop("kdenlive:duration", totalFrames)}
  ${prop("kdenlive:maxduration", totalFrames)}
  ${prop("kdenlive:producer_type", 17)}
  ${prop("kdenlive:id", sequenceId)}
  ${prop("kdenlive:clip_type", 0)}
  ${prop("kdenlive:folderid", -1)}
  <track producer="black_track"/>
${tracks.map((track) => `  <track producer="${track.id}"/>`).join("\n")}
${transitions.join("\n")}
${AUDIO_TRACK_FILTERS("sequence")}
</tractor>
<playlist id="main_bin">
  ${prop("kdenlive:sequenceFolder", -1)}
  ${prop("kdenlive:docproperties.audioChannels", 2)}
  ${prop("kdenlive:docproperties.compositing", 1)}
  ${prop("kdenlive:docproperties.documentid", Date.now())}
  ${prop("kdenlive:docproperties.enableproxy", 0)}
  ${prop("kdenlive:docproperties.generateproxy", 0)}
  ${prop("kdenlive:docproperties.kdenliveversion", KDENLIVE_VERSION)}
  ${prop("kdenlive:docproperties.seekOffset", 30000)}
  ${prop("kdenlive:docproperties.uuid", uuid)}
  ${prop("kdenlive:docproperties.version", "1.1")}
  ${prop("kdenlive:docproperties.opensequences", uuid)}
  ${prop("kdenlive:docproperties.activetimeline", uuid)}
  ${prop("kdenlive:documentnotes", "")}
  ${prop("xml_retain", 1)}
${all.map((src) => `  <entry producer="${src.binId}" in="0" out="${src.length - 1}"/>`).join("\n")}
  <entry producer="${uuid}" in="0" out="0"/>
</playlist>
<tractor id="tractor_project" in="0" out="${totalFrames - 1}">
  ${prop("kdenlive:projectTractor", 1)}
  <track producer="${uuid}" in="0" out="${totalFrames - 1}"/>
</tractor>
</mlt>
`;
  const file = `${name}.kdenlive`;
  fs.mkdirSync(timelineDirPath, { recursive: true });
  fs.writeFileSync(path.join(timelineDirPath, file), body, "utf8");
  return `timeline/${file}`;
}
