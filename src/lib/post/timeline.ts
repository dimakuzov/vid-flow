import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { collectPost, type CollectedLine } from "./collect";
import { probeMedia } from "./ffmpeg";
import { writeKdenliveProject } from "./kdenlive";
import { readShotFinal, writePostLines, type ShotFinal } from "./lines";
import { activeShotIds, manifestFile, postDir, readJson, TIMELINE_FPS, timelineDir, writeJson } from "./paths";

/*
 * Таймлайн: проект Kdenlive (`kdenlive.ts`) и FCPXML 1.9 для Resolve (File → Import → Timeline), манифест к ним.
 * Видео: финалы кадров подряд (без своего звука). Звук финала H3/HeyGen — отдельной выключенной
 * дорожкой для сверки с губами. Дальше по дорожке на персонажа: каждая реплика — отрезок длинного
 * файла озвучки, так в Resolve можно потянуть край клипа. Собирается локально, бесплатно.
 */

export interface TimelineOptions {
  width?: number;
  height?: number;
  /** Заметки сборки (например, кадры, где речь не распознана) — в начало `warnings`. */
  notes?: string[];
}

export const DEFAULT_SIZE = { width: 720, height: 1280 };
/** Кадр без финала: пустое место не короче этого. */
const MISSING_SHOT_SEC = 3;

export interface ManifestShot {
  shotId: string;
  /** Путь от папки эпизода; null — финала нет, на таймлайне пустое место. */
  file: string | null;
  start: number;
  duration: number;
  hasAudio: boolean;
}

export interface ManifestLine {
  id: string;
  shotId: string;
  character: string;
  text: string;
  /** Путь от папки поста: `voices/Lena/v2.wav`. */
  source: string;
  sourceIn: number;
  sourceOut: number;
  at: number;
  /** Скорость клипа (подгонка под губы или ручная); на таймлайне клип короче/длиннее в столько раз. */
  speed: number;
  /** Рамка губ в кадре (секунды от начала кадра), если речь в финале распознана. */
  window: { start: number; end: number } | null;
  timelineStart: number;
  timelineEnd: number;
  /** Дорожка FCPXML (отрицательная — под видео). */
  lane: number;
}

export interface Manifest {
  episodeId: string;
  builtAt: string;
  fps: number;
  width: number;
  height: number;
  /** Путь от папки поста: `timeline/ep2_v3.fcpxml`. */
  timeline: string;
  /** Проект Kdenlive той же сборки: `timeline/ep2_v3.kdenlive`. */
  kdenlive?: string;
  duration: number;
  characters: { name: string; lane: number }[];
  shots: ManifestShot[];
  lines: ManifestLine[];
  skipped: { id: string; reason: string }[];
  warnings: string[];
}

export function readManifest(episodeId: string): Manifest | null {
  return readJson<Manifest>(manifestFile(episodeId));
}

export function listTimelines(episodeId: string, ext = ".fcpxml"): string[] {
  try {
    return fs
      .readdirSync(timelineDir(episodeId))
      .filter((name) => name.endsWith(ext))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

function nextTimelineName(episodeId: string): string {
  const numbers = listTimelines(episodeId)
    .map((name) => name.match(/_v(\d+)\.fcpxml$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number);
  return `${episodeId}_v${Math.max(0, ...numbers) + 1}.fcpxml`;
}

const frames = (seconds: number) => Math.round(seconds * TIMELINE_FPS);
const time = (frameCount: number) => (frameCount === 0 ? "0s" : `${frameCount}/${TIMELINE_FPS}s`);

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fileUrl(absolute: string): string {
  return pathToFileURL(absolute).href;
}

function reasonText(line: CollectedLine): string {
  if (line.voice === "no-character") return "в speech.md не указан персонаж";
  if (line.voice === "no-voice") return `нет озвучки ${line.character}`;
  return `текст изменился после озвучки ${line.character} — перегенерируйте персонажа`;
}

interface SpineItem {
  shotId: string;
  startFrame: number;
  durationFrames: number;
  final: ShotFinal | null;
  children: string[];
}

/**
 * Собирает новую версию таймлайна и манифест. Реплики без актуальной озвучки пропускаются
 * (список — в `skipped`). Пишет `timeline/{ep}_v{N}.fcpxml`, `manifest.json` и `lines.json`.
 */
export async function buildTimeline(episodeId: string, options: TimelineOptions = {}): Promise<Manifest> {
  const width = Math.round(options.width || DEFAULT_SIZE.width);
  const height = Math.round(options.height || DEFAULT_SIZE.height);
  if (!(width >= 64 && width <= 8192 && height >= 64 && height <= 8192)) throw new Error("Размер кадра: от 64 до 8192");

  const finals = new Map<string, ShotFinal>();
  // Скрытые с таблицы кадры в видео не идут: ни кадра, ни пустоты, ни реплик.
  const shotIds = activeShotIds(episodeId);
  for (const shotId of shotIds) finals.set(shotId, await readShotFinal(episodeId, shotId));
  const { lines } = await collectPost(episodeId, finals);
  const warnings: string[] = [...(options.notes ?? [])];
  const skipped: Manifest["skipped"] = [];

  // Кадры подряд.
  const spine: SpineItem[] = [];
  let cursor = 0;
  for (const shotId of shotIds) {
    const final = finals.get(shotId)!;
    let durationFrames: number;
    if (final.file && final.probe) {
      durationFrames = Math.max(1, frames(final.probe.duration));
      if (final.probe.fps && Math.abs(final.probe.fps - TIMELINE_FPS) > 0.01) {
        warnings.push(`${shotId}: финал ${Math.round(final.probe.fps * 100) / 100} fps, таймлайн ${TIMELINE_FPS} — редактор подгонит`);
      }
    } else {
      const own = lines.filter((line) => line.shotId === shotId && line.clip);
      const needed = Math.max(
        MISSING_SHOT_SEC,
        ...own.map((line) => line.at + (line.clip!.out - line.clip!.speechStart)),
      );
      durationFrames = frames(needed);
      warnings.push(`${shotId}: нет финала в final_render/approve — на таймлайне пустое место ${Math.round(needed * 10) / 10} с`);
    }
    spine.push({ shotId, startFrame: cursor, durationFrames, final: final.file ? final : null, children: [] });
    cursor += durationFrames;
  }
  const totalFrames = cursor;

  // Дорожки: -1 — звук финалов (выключен), дальше персонажи в порядке первой реплики.
  const hasOriginalAudio = spine.some((item) => item.final?.probe?.hasAudio);
  const characterOrder: string[] = [];
  for (const line of lines) if (line.clip && !characterOrder.includes(line.character)) characterOrder.push(line.character);
  const laneOf = (character: string) => -(characterOrder.indexOf(character) + (hasOriginalAudio ? 2 : 1));

  // Ресурсы.
  const formats = new Map<string, string>();
  const formatId = (fps: number, w: number, h: number) => {
    const key = `${fps}|${w}|${h}`;
    if (!formats.has(key)) formats.set(key, `r${formats.size + 2}`);
    return formats.get(key)!;
  };
  const assets: string[] = [];
  const assetIds = new Map<string, string>();
  const episodeDir = path.dirname(postDir(episodeId));
  const postRoot = postDir(episodeId);

  for (const item of spine) {
    if (!item.final?.file || !item.final.probe) continue;
    const probe = item.final.probe;
    const id = `a${assetIds.size + 1}`;
    assetIds.set(item.final.file, id);
    const format = formatId(probe.fps || TIMELINE_FPS, probe.width, probe.height);
    const audio = probe.hasAudio
      ? ` hasAudio="1" audioSources="1" audioChannels="${probe.audioChannels || 2}" audioRate="${probe.audioRate || 48000}"`
      : "";
    assets.push(
      `    <asset id="${id}" name="${xml(item.shotId)}" start="0s" duration="${time(frames(probe.duration))}" hasVideo="1" format="${format}"${audio}>\n` +
        `      <media-rep kind="original-media" src="${xml(fileUrl(item.final.file))}"/>\n` +
        `    </asset>`,
    );
  }

  const voiceAsset = async (source: string, character: string, version: number): Promise<string> => {
    const existing = assetIds.get(source);
    if (existing) return existing;
    const id = `a${assetIds.size + 1}`;
    assetIds.set(source, id);
    const probe = await probeMedia(source);
    assets.push(
      `    <asset id="${id}" name="${xml(`${character} v${version}`)}" start="0s" duration="${time(Math.ceil(probe.duration * TIMELINE_FPS))}" hasAudio="1" audioSources="1" audioChannels="${probe.audioChannels || 1}" audioRate="${probe.audioRate || 44100}">\n` +
        `      <media-rep kind="original-media" src="${xml(fileUrl(source))}"/>\n` +
        `    </asset>`,
    );
    return id;
  };

  // Звук финалов — выключенные клипы на дорожке -1.
  for (const item of spine) {
    if (!item.final?.file || !item.final.probe?.hasAudio) continue;
    item.children.push(
      `          <asset-clip ref="${assetIds.get(item.final.file)}" lane="-1" offset="0s" start="0s" duration="${time(item.durationFrames)}" name="${xml(`${item.shotId} звук финала`)}" srcEnable="audio" enabled="0"/>`,
    );
  }

  // Реплики.
  const manifestLines: ManifestLine[] = [];
  const lastEnd = new Map<string, { frame: number; id: string }>();
  for (const line of lines) {
    if (!line.clip) {
      skipped.push({ id: line.id, reason: reasonText(line) });
      continue;
    }
    const shot = spine.find((item) => item.shotId === line.shotId)!;
    const speed = line.clip.speed;
    let sourceIn = line.clip.in;
    const shotStart = shot.startFrame / TIMELINE_FPS;
    // Начало речи — на `at`; запас перед ним на таймлайне сжат или растянут скоростью.
    let start = shotStart + line.at - (line.clip.speechStart - sourceIn) / speed;
    if (start < 0) {
      sourceIn -= start * speed;
      start = 0;
    }
    const startFrame = frames(start);
    const inFrame = frames(sourceIn);
    const sourceFrames = Math.max(1, frames(line.clip.out) - inFrame);
    const durationFrames = sourceFrames;
    const endFrame = startFrame + Math.max(1, Math.round(sourceFrames / speed));
    if (line.clip.fit?.clamped) {
      warnings.push(
        `${line.id}: чтобы попасть в губы, нужна скорость ${line.clip.fit.wanted}× — стоит ${line.clip.speed}× (предел), поправьте реплику или рамку`,
      );
    }
    const lane = laneOf(line.character);
    if (line.at > shot.durationFrames / TIMELINE_FPS) {
      warnings.push(`${line.id}: место ${line.at} с позже конца кадра ${line.shotId}`);
    }
    const previous = lastEnd.get(line.character);
    if (previous && previous.frame > startFrame) {
      warnings.push(`${line.id} наезжает на ${previous.id} (${line.character}) — в Kdenlive конец предыдущей обрежется, в Resolve реплика уйдёт на соседнюю дорожку`);
    }
    lastEnd.set(line.character, { frame: endFrame, id: line.id });
    // Клип цепляется к тому элементу ленты, внутри которого начинается.
    const parent =
      spine.find((item) => startFrame >= item.startFrame && startFrame < item.startFrame + item.durationFrames) ??
      spine[spine.length - 1];
    const ref = await voiceAsset(line.clip.source, line.character, line.clip.version);
    parent.children.push(
      `          <asset-clip ref="${ref}" lane="${lane}" offset="${time(startFrame - parent.startFrame)}" start="${time(inFrame)}" duration="${time(durationFrames)}" name="${xml(`${line.id} ${line.character}: ${line.text.slice(0, 60)}`)}"/>`,
    );
    manifestLines.push({
      id: line.id,
      shotId: line.shotId,
      character: line.character,
      text: line.text,
      source: path.relative(postRoot, line.clip.source).split(path.sep).join("/"),
      sourceIn: inFrame / TIMELINE_FPS,
      sourceOut: (inFrame + sourceFrames) / TIMELINE_FPS,
      at: line.at,
      speed,
      window: line.window ? { start: line.window.start, end: line.window.end } : null,
      timelineStart: startFrame / TIMELINE_FPS,
      timelineEnd: endFrame / TIMELINE_FPS,
      lane,
    });
  }
  const endFrame = Math.max(totalFrames, ...manifestLines.map((line) => frames(line.timelineEnd)));
  if (manifestLines.some((line) => line.speed !== 1)) {
    warnings.push("Скорость реплик (подгонка под губы) есть только в проекте Kdenlive; в FCPXML клипы без ускорения");
  }

  const spineXml = spine
    .map((item) => {
      const children = item.children.length ? `\n${item.children.join("\n")}\n        ` : "";
      if (!item.final?.file) {
        return `        <gap name="${xml(`${item.shotId} — нет финала`)}" offset="${time(item.startFrame)}" start="0s" duration="${time(item.durationFrames)}">${children}</gap>`;
      }
      return `        <asset-clip ref="${assetIds.get(item.final.file)}" offset="${time(item.startFrame)}" start="0s" duration="${time(item.durationFrames)}" name="${xml(item.shotId)}" srcEnable="video">${children}</asset-clip>`;
    })
    .join("\n");

  const formatXml = [
    `    <format id="r1" frameDuration="1/${TIMELINE_FPS}s" width="${width}" height="${height}"/>`,
    ...[...formats.entries()].map(([key, id]) => {
      const [fps, w, h] = key.split("|").map(Number);
      const duration = Number.isInteger(fps) ? `1/${fps}s` : `${Math.round(100000 / fps)}/100000s`;
      return `    <format id="${id}" frameDuration="${duration}"${w ? ` width="${w}"` : ""}${h ? ` height="${h}"` : ""}/>`;
    }),
  ].join("\n");

  const name = nextTimelineName(episodeId);
  const project = name.replace(/\.fcpxml$/, "");
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
${formatXml}
${assets.join("\n")}
  </resources>
  <library>
    <event name="${xml(`${episodeId} post`)}">
      <project name="${xml(project)}">
        <sequence format="r1" duration="${time(endFrame)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spineXml}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
  fs.mkdirSync(timelineDir(episodeId), { recursive: true });
  fs.writeFileSync(path.join(timelineDir(episodeId), name), body, "utf8");

  const manifest: Manifest = {
    episodeId,
    builtAt: new Date().toISOString(),
    fps: TIMELINE_FPS,
    width,
    height,
    timeline: `timeline/${name}`,
    duration: endFrame / TIMELINE_FPS,
    characters: characterOrder.map((character) => ({ name: character, lane: laneOf(character) })),
    shots: spine.map((item) => ({
      shotId: item.shotId,
      file: item.final?.file ? path.relative(episodeDir, item.final.file).split(path.sep).join("/") : null,
      start: item.startFrame / TIMELINE_FPS,
      duration: item.durationFrames / TIMELINE_FPS,
      hasAudio: Boolean(item.final?.probe?.hasAudio),
    })),
    lines: manifestLines,
    skipped,
    warnings,
  };
  manifest.kdenlive = await writeKdenliveProject(episodeId, manifest, timelineDir(episodeId), project);
  writeJson(manifestFile(episodeId), manifest);
  writePostLines(episodeId, lines);
  return manifest;
}
