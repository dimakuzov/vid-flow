import { parseMltTime } from "./project-read";

/*
 * Что звучит в проекте Kdenlive: клипы на включённых аудиодорожках, которые сведены в последовательность
 * (переход `mix`). Доска правит проект пользователя («Добавить субтитры») — после правки всё, что звучало,
 * должно звучать так же: на любой дорожке, со своими репликами или без.
 */

/** Клипы музыки, которые ставит и заменяет сама доска. */
const BOARD_PRODUCER = /^frameboard_/;

function attrOf(attrs: string, name: string): string | undefined {
  return attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

function propertyOf(block: string, name: string): string | undefined {
  return block.match(new RegExp(`<property name="${name.replace(/[.]/g, "\\.")}">([^<]*)</property>`))?.[1];
}

/** Звучащие клипы: «дорожка | файл | in–out | где на таймлайне», в кадрах. */
export function audibleClips(xml: string, fps: number): string[] {
  const resources = new Map<string, string>();
  for (const match of xml.matchAll(/<(chain|producer) id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    resources.set(match[2], propertyOf(match[3], "resource") ?? match[2]);
  }
  const playlists = new Map<string, string>();
  for (const match of xml.matchAll(/<playlist id="([^"]+)"[^>]*?(?<!\/)>([\s\S]*?)<\/playlist>/g)) playlists.set(match[1], match[2]);
  const tractors = new Map<string, string>();
  for (const match of xml.matchAll(/<tractor id="([^"]+)"[^>]*>([\s\S]*?)<\/tractor>/g)) tractors.set(match[1], match[2]);

  const clips = (playlist: string, track: string): string[] => {
    const body = playlists.get(playlist);
    if (!body) return [];
    const found: string[] = [];
    let cursor = 0;
    for (const item of body.matchAll(/<blank\s([^>]*?)\/?>|<entry\s([^>]*?)\/?>/g)) {
      if (item[1] !== undefined) {
        cursor += parseMltTime(attrOf(item[1], "length"), fps);
        continue;
      }
      const inFrame = parseMltTime(attrOf(item[2], "in"), fps);
      const outFrame = parseMltTime(attrOf(item[2], "out"), fps);
      const producer = attrOf(item[2], "producer") ?? "";
      if (!BOARD_PRODUCER.test(producer)) found.push(`${track} | ${resources.get(producer) ?? producer} | ${inFrame}–${outFrame} | ${cursor}`);
      cursor += outFrame - inFrame + 1;
    }
    return found;
  };
  const silent = (attrs: string) => /^(audio|both)$/.test(attrOf(attrs, "hide") ?? "");

  const result: string[] = [];
  for (const body of tractors.values()) {
    // Последовательность: дорожки, сведённые переходом mix (номер MLT, чёрная — 0).
    const mixed = new Set<number>();
    for (const transition of body.matchAll(/<transition [^>]*>([\s\S]*?)<\/transition>/g)) {
      if (propertyOf(transition[1], "mlt_service") !== "mix") continue;
      mixed.add(Number(propertyOf(transition[1], "b_track")));
    }
    if (!mixed.size) continue;
    [...body.matchAll(/<track ([^>]*?)\/>/g)].forEach((track, index) => {
      if (!mixed.has(index) || silent(track[1])) return;
      const producer = attrOf(track[1], "producer") ?? "";
      const inner = tractors.get(producer);
      if (inner === undefined) {
        result.push(...clips(producer, producer));
        return;
      }
      const name = propertyOf(inner, "kdenlive:track_name") ?? producer;
      for (const part of inner.matchAll(/<track ([^>]*?)\/>/g)) {
        if (!silent(part[1])) result.push(...clips(attrOf(part[1], "producer") ?? "", name));
      }
    });
  }
  return result.sort();
}

/** Что звучало в `before` и не звучит в `after`. */
export function lostAudio(before: string, after: string, fps: number): string[] {
  const left = new Set(audibleClips(after, fps));
  return audibleClips(before, fps).filter((clip) => !left.has(clip));
}
