import fs from "fs";
import path from "path";
import { readJson } from "./paths";

/*
 * Что реально лежит в отредактированном проекте Kdenlive: клипы озвучки на дорожках, какой отрезок файла
 * каждый играет и, по `vN.json` рядом с файлом, какие реплики в этот отрезок попадают. Нужно субтитрам:
 * вырезанные в Kdenlive фразы в субтитры не идут, порядок — как на таймлайне.
 */

export interface ProjectLine {
  /** id реплики (`s05-2`) и её текст — как при озвучке (`vN.json`). */
  id: string;
  text: string;
  /** Где речь реплики начинается на таймлайне, секунды. */
  time: number;
}

/** Время Kdenlive/MLT в кадрах: целое — кадры, `ЧЧ:ММ:СС.ммм` — время. */
export function parseMltTime(value: string | undefined, fps: number): number {
  if (!value) return 0;
  if (/^-?\d+$/.test(value)) return Number(value);
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return Math.round(parts.reduce((sum, part) => sum * 60 + part, 0) * fps);
}

function propertyOf(block: string, name: string): string | undefined {
  return block.match(new RegExp(`<property name="${name.replace(/[.]/g, "\\.")}">([^<]*)</property>`))?.[1];
}

const VOICE_FILE = /[\\/]voices[\\/][^\\/]+[\\/]v(\d+)(?:\.raw|\.clean)?\.wav$/i;

interface VoiceSource {
  file: string;
  speed: number;
}

/** Клипы озвучки по id продюсера: файл и скорость (`timewarp`). */
function voiceProducers(xml: string, root: string): Map<string, VoiceSource> {
  const result = new Map<string, VoiceSource>();
  for (const match of xml.matchAll(/<(chain|producer) id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    const [, , id, body] = match;
    const warp = propertyOf(body, "warp_resource");
    const resource = warp ?? propertyOf(body, "resource")?.replace(/^-?\d+(?:\.\d+)?:/, "");
    if (!resource) continue;
    const file = path.isAbsolute(resource) || /^[A-Za-z]:[\\/]/.test(resource) ? resource : path.join(root, resource);
    if (!VOICE_FILE.test(file)) continue;
    const speed = Number(propertyOf(body, "warp_speed") ?? 1);
    result.set(id, { file, speed: Number.isFinite(speed) && speed > 0 ? speed : 1 });
  }
  return result;
}

interface VersionLines {
  lines: { id: string; text: string; speechStart: number; speechEnd: number }[];
}

/** Реплики, которые играют клипы озвучки проекта, по времени на таймлайне. */
export function projectVoiceLines(xml: string, fps: number): ProjectLine[] {
  const root = xml.match(/<mlt [^>]*\broot="([^"]*)"/)?.[1] ?? "";
  const producers = voiceProducers(xml, root);
  const versions = new Map<string, VersionLines | null>();
  const versionOf = (file: string) => {
    const number = file.match(VOICE_FILE)?.[1];
    const json = path.join(path.dirname(file), `v${number}.json`);
    if (!versions.has(json)) versions.set(json, fs.existsSync(json) ? readJson<VersionLines>(json) : null);
    return versions.get(json) ?? null;
  };

  const found: ProjectLine[] = [];
  // Пустой плейлист — `<playlist id="x"/>`: его не открываем, иначе захватит соседний.
  for (const match of xml.matchAll(/<playlist id="([^"]+)"[^>]*?(?<!\/)>([\s\S]*?)<\/playlist>/g)) {
    const [, id, body] = match;
    if (id === "main_bin") continue;
    let cursor = 0;
    // Порядок атрибутов любой: доска пишет producer/in/out, Kdenlive при сохранении — in/out/producer.
    for (const item of body.matchAll(/<blank\s([^>]*?)\/?>|<entry\s([^>]*?)\/?>/g)) {
      const attrs = item[1] ?? item[2];
      const attr = (name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
      if (item[1] !== undefined) {
        cursor += parseMltTime(attr("length"), fps);
        continue;
      }
      const inFrame = parseMltTime(attr("in"), fps);
      const outFrame = parseMltTime(attr("out"), fps);
      const start = cursor;
      cursor += outFrame - inFrame + 1;
      const source = producers.get(attr("producer") ?? "");
      if (!source) continue;
      const version = versionOf(source.file);
      if (!version) continue;
      // Кадры timewarp — уже со скоростью: в секунды файла — умножить на скорость.
      const srcIn = (inFrame * source.speed) / fps;
      const srcOut = ((outFrame + 1) * source.speed) / fps;
      for (const line of version.lines) {
        const length = Math.max(0.01, line.speechEnd - line.speechStart);
        const overlap = Math.min(srcOut, line.speechEnd) - Math.max(srcIn, line.speechStart);
        if (overlap < length * 0.5) continue;
        const time = start / fps + (Math.max(srcIn, line.speechStart) - srcIn) / source.speed;
        found.push({ id: line.id, text: line.text, time: Math.round(time * 1000) / 1000 });
      }
    }
  }
  return found
    .sort((a, b) => a.time - b.time)
    .filter((line, index, all) => index === 0 || !(all[index - 1].id === line.id && Math.abs(all[index - 1].time - line.time) < 0.05));
}
