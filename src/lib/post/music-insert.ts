import { MUSIC_TRACK_NAME } from "./music";

/*
 * Музыка в уже отредактированный проект Kdenlive: дорожка «Музыка» (её оставляет пустой сборка) заполняется
 * файлами по кругу до конца, на дорожку — эффект Volume с ключевыми кадрами. Номера дорожек не меняются,
 * поэтому группы и переходы пользователя остаются как были. Повторный запуск заменяет свою музыку.
 * Свои клипы и эффект помечены: id `frameboard_music*` и свойство `frameboard:music`.
 */

export interface MusicSource {
  /** Абсолютный путь файла. */
  file: string;
  /** Длина в кадрах проекта. */
  frames: number;
  label: string;
}

export class MusicTrackMissingError extends Error {
  constructor() {
    super(`В проекте нет дорожки «${MUSIC_TRACK_NAME}» — соберите проект заново («Собрать проект») или добавьте музыку вручную`);
    this.name = "MusicTrackMissingError";
  }
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function prop(name: string, value: string | number): string {
  return `<property name="${name}">${xml(String(value))}</property>`;
}

/** Блок `<tag ...>…</tag>` (или самозакрытый), начинающийся с `start`. */
function elementEnd(text: string, start: number, tag: string): number {
  const headEnd = text.indexOf(">", start);
  if (text[headEnd - 1] === "/") return headEnd + 1;
  return text.indexOf(`</${tag}>`, headEnd) + `</${tag}>`.length;
}

/**
 * Дорожка «Музыка» в проекте, где её нет (собран до того, как сборка стала её оставлять): новая нижняя аудиодорожка
 * сразу над чёрной. Номера остальных дорожек сдвигаются на 1: в переходах последовательности (`a_track`, `b_track` —
 * номера MLT, чёрная — 0) и в группах и целях Kdenlive (`groups`, `audioTarget`, `videoTarget`, `activeTrack` — номера
 * без чёрной, первая дорожка — 0; так в tests/dataset/test-nesting.kdenlive).
 */
export function ensureMusicTrack(project: string, totalFrames: number): string {
  if (project.includes(`<property name="kdenlive:track_name">${xml(MUSIC_TRACK_NAME)}</property>`)) return project;
  const active = project.match(/<property name="kdenlive:docproperties\.activetimeline">([^<]+)<\/property>/)?.[1];
  if (!active) throw new MusicTrackMissingError();
  let open = project.indexOf(`<tractor id="${active}"`);
  if (open < 0) {
    const marker = project.indexOf(`<property name="kdenlive:uuid">${active}</property>`);
    if (marker >= 0) open = project.lastIndexOf("<tractor ", marker);
  }
  if (open < 0) throw new MusicTrackMissingError();
  const close = project.indexOf("</tractor>", open);
  let block = project.slice(open, close);

  const firstTrack = block.match(/<track [^>]*\/>/);
  if (!firstTrack) throw new MusicTrackMissingError();
  const shiftFrom = (from: number) => (value: string) => {
    const number = Number(value);
    return Number.isInteger(number) && number >= from ? String(number + 1) : value;
  };
  const shiftMlt = shiftFrom(1);
  const shiftKdenlive = shiftFrom(0);
  // Переходы последовательности: номера дорожек ≥ 1 — на 1 выше.
  block = block.replace(/(<property name="(?:a_track|b_track)">)(\d+)(<\/property>)/g, (_, a: string, n: string, b: string) => `${a}${shiftMlt(n)}${b}`);
  for (const name of ["audioTarget", "videoTarget", "activeTrack"]) {
    block = block.replace(
      new RegExp(`(<property name="kdenlive:sequenceproperties\\.${name}">)(-?\\d+)(</property>)`),
      (_, a: string, n: string, b: string) => `${a}${shiftKdenlive(n)}${b}`,
    );
  }
  for (const name of ["tracksCount", "tracks"]) {
    block = block.replace(
      new RegExp(`(<property name="kdenlive:sequenceproperties\\.${name}">)(\\d+)(</property>)`),
      (_, a: string, n: string, b: string) => `${a}${Number(n) + 1}${b}`,
    );
  }
  // Группы: "data": "дорожка:позиция:…" — все дорожки сдвигаются (дорожка субтитров — отрицательная, не трогаем).
  block = block.replace(/(&quot;|")data\1:\s*\1(\d+):/g, (whole, quote: string, n: string) => whole.replace(`${quote}${n}:`, `${quote}${shiftKdenlive(n)}:`));

  const trackRef = `<track producer="frameboard_music_tractor"/>`;
  block = block.replace(firstTrack[0], `${firstTrack[0]}\n  ${trackRef}`);
  const mix = `  <transition id="frameboard_music_mix">
   ${prop("a_track", 0)}
   ${prop("b_track", 1)}
   ${prop("mlt_service", "mix")}
   ${prop("kdenlive_id", "mix")}
   ${prop("internal_added", 237)}
   ${prop("always_active", 1)}
   ${prop("accepts_blanks", 1)}
   ${prop("sum", 1)}
  </transition>`;
  block = `${block.trimEnd()}\n${mix}\n `;

  const last = Math.max(0, totalFrames - 1);
  const track = `<playlist id="frameboard_music_playlist">
  ${prop("kdenlive:audio_track", 1)}
 </playlist>
 <playlist id="frameboard_music_playlist_mix">
  ${prop("kdenlive:audio_track", 1)}
 </playlist>
 <tractor id="frameboard_music_tractor" in="0" out="${last}">
  ${prop("kdenlive:audio_track", 1)}
  ${prop("kdenlive:track_name", MUSIC_TRACK_NAME)}
  ${prop("kdenlive:trackheight", 67)}
  ${prop("kdenlive:timeline_active", 1)}
  ${prop("kdenlive:collapsed", 0)}
  <track hide="video" producer="frameboard_music_playlist"/>
  <track hide="video" producer="frameboard_music_playlist_mix"/>
  <filter id="frameboard_music_volume">
   ${prop("window", 75)}
   ${prop("max_gain", "20dB")}
   ${prop("mlt_service", "volume")}
   ${prop("internal_added", 237)}
   ${prop("disable", 1)}
  </filter>
  <filter id="frameboard_music_panner">
   ${prop("channel", -1)}
   ${prop("mlt_service", "panner")}
   ${prop("internal_added", 237)}
   ${prop("start", 0.5)}
   ${prop("disable", 1)}
  </filter>
 </tractor>
 `;
  // Определения дорожки — до последовательности, которая на них ссылается.
  return project.slice(0, open) + track + block + project.slice(close);
}

export function insertMusic(project: string, sources: MusicSource[], totalFrames: number, level: string): string {
  if (!sources.length) return project;
  let text = ensureMusicTrack(project, totalFrames);

  // Прошлая своя музыка: определения клипов и записи в корзине.
  text = text.replace(/\s*<chain id="frameboard_music\d+(?:_audio)?"[\s\S]*?<\/chain>/g, "");
  text = text.replace(/\s*<entry producer="frameboard_music\d+"[^>]*\/>/g, "");

  const nameAt = text.indexOf(`<property name="kdenlive:track_name">${xml(MUSIC_TRACK_NAME)}</property>`);
  if (nameAt < 0) throw new MusicTrackMissingError();
  const tractorStart = text.lastIndexOf("<tractor ", nameAt);
  const tractorEnd = text.indexOf("</tractor>", nameAt);
  const playlistId = text.slice(tractorStart, tractorEnd).match(/<track [^>]*producer="([^"]+)"/)?.[1];
  if (!playlistId) throw new MusicTrackMissingError();

  let nextId = Math.max(0, ...[...text.matchAll(/<property name="kdenlive:id">(\d+)<\/property>/g)].map((match) => Number(match[1]))) + 1;
  const chains: string[] = [];
  const binEntries: string[] = [];
  const ids = sources.map((source, index) => {
    const id = `frameboard_music${index}`;
    const kdenliveId = nextId++;
    const length = Math.max(1, source.frames);
    const common = [
      prop("length", length),
      prop("eof", "pause"),
      prop("resource", source.file.split("\\").join("/")),
      prop("mlt_service", "avformat-novalidate"),
      prop("seekable", 1),
      prop("audio_index", 0),
      prop("video_index", -1),
      prop("kdenlive:clipname", source.label),
      prop("kdenlive:folderid", -1),
      prop("kdenlive:id", kdenliveId),
    ];
    chains.push(`<chain id="${id}" out="${length - 1}">\n  ${common.join("\n  ")}\n </chain>`);
    chains.push(`<chain id="${id}_audio" out="${length - 1}">\n  ${[...common, prop("set.test_audio", 0), prop("set.test_image", 1)].join("\n  ")}\n </chain>`);
    binEntries.push(`  <entry producer="${id}" in="0" out="${length - 1}"/>`);
    return { id: `${id}_audio`, kdenliveId, length };
  });

  // Клипы дорожки: файлы по кругу, последний обрезан по концу проекта.
  const entries: string[] = [];
  for (let cursor = 0, index = 0; cursor < totalFrames; index += 1) {
    const clip = ids[index % ids.length];
    const length = Math.min(clip.length, totalFrames - cursor);
    entries.push(`  <entry producer="${clip.id}" in="0" out="${length - 1}">\n   ${prop("kdenlive:id", clip.kdenliveId)}\n  </entry>`);
    cursor += length;
  }

  // Плейлист дорожки: свои свойства оставляем, клипы — новые; определения клипов — перед ним.
  const playlistStart = text.indexOf(`<playlist id="${playlistId}"`);
  if (playlistStart < 0) throw new MusicTrackMissingError();
  const playlistEnd = elementEnd(text, playlistStart, "playlist");
  const properties = text.slice(playlistStart, playlistEnd).match(/<property [^>]*>[^<]*<\/property>|<property [^>]*\/>/g) ?? [];
  const playlist = `<playlist id="${playlistId}">\n  ${properties.join("\n  ")}${properties.length ? "\n" : ""}${entries.join("\n")}\n </playlist>`;
  text = `${text.slice(0, playlistStart)}${chains.join("\n ")}\n ${playlist}${text.slice(playlistEnd)}`;

  // Эффект громкости на дорожке «Музыка»: свой прошлый — заменить.
  const nameAgain = text.indexOf(`<property name="kdenlive:track_name">${xml(MUSIC_TRACK_NAME)}</property>`);
  const tractorOpen = text.lastIndexOf("<tractor ", nameAgain);
  const tractorClose = text.indexOf("</tractor>", nameAgain);
  let tractor = text.slice(tractorOpen, tractorClose);
  // Kdenlive при сохранении переименовывает id и может не сохранить свою метку — заменяем любой эффект Volume
  // этой дорожки (служебные громкость и панорама Kdenlive — без kdenlive_id volume, их не трогаем).
  tractor = tractor.replace(
    /\s*<filter [^>]*>(?:(?!<\/filter>)[\s\S])*?(?:<property name="frameboard:music">1<\/property>|<property name="kdenlive_id">volume<\/property>)[\s\S]*?<\/filter>/g,
    "",
  );
  const filter = `  <filter id="frameboard_music_level">
   ${prop("window", 75)}
   ${prop("max_gain", "20dB")}
   ${prop("mlt_service", "volume")}
   ${prop("kdenlive_id", "volume")}
   ${prop("level", level)}
   ${prop("kdenlive:collapsed", 0)}
   ${prop("frameboard:music", 1)}
  </filter>`;
  tractor = `${tractor.trimEnd()}\n${filter}\n `;
  text = text.slice(0, tractorOpen) + tractor + text.slice(tractorClose);

  // Корзина проекта.
  const binStart = text.indexOf('<playlist id="main_bin"');
  if (binStart >= 0) {
    const binClose = text.indexOf("</playlist>", binStart);
    text = `${text.slice(0, binClose)}${binEntries.join("\n")}\n ${text.slice(binClose)}`;
  }
  return text;
}

/** Отрезки речи (кадры) по словам Whisper: слова ближе `mergeSec` друг к другу — одна речь. */
export function speechFromWords(words: { start: number; end: number }[], fps: number, mergeSec = 0.6): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (const word of [...words].sort((a, b) => a.start - b.start)) {
    const last = ranges[ranges.length - 1];
    if (last && word.start - last.end <= mergeSec) last.end = Math.max(last.end, word.end);
    else ranges.push({ start: word.start, end: word.end });
  }
  return ranges.map((range) => ({ start: Math.round(range.start * fps), end: Math.round(range.end * fps) }));
}
