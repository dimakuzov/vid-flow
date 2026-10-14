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

export function insertMusic(project: string, sources: MusicSource[], totalFrames: number, level: string): string {
  if (!sources.length) return project;
  let text = project;

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
