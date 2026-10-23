// Пост: реплики из speech.md → озвучка (поддельный ElevenLabs) → границы → манифест и FCPXML.
// Звук и видео — настоящие файлы ffmpeg во временной DATA_ROOT; в ElevenLabs ничего не уходит.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-post-"));
process.env.DATA_ROOT = tmp;
process.env.FRAMEBOARD_LOOPS = "off";
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.ELEVENLABS_API_KEY = "test-key";
process.env.POST_TTS_CHUNK_CHARS = "60";
// Пресет рендера Kdenlive — во временную папку, не в настоящий AppData.
process.env.KDENLIVE_DATA = tmp;
delete process.env.SERIES_ROOT;

import { readComfyJob } from "../comfy/queue";
import { setShotHidden } from "../series/hidden-shots";
import { createEpisode, getCharactersRoot, getComfyQueueRoot, shotDir, stageDir } from "../series/paths";
import { lineSeparator } from "./align";
import { collectPost } from "./collect";
import { probeMedia, synthesizeMedia } from "./ffmpeg";
import { readPostLines, updatePostLine } from "./lines";
import { linesFile, manifestFile, postDir, timelineDir, voicesDir } from "./paths";
import { assignSpeaker, speakerResolver } from "./speakers";
import { buildProject } from "./build";
import { insertMusic, MusicTrackMissingError } from "./music-insert";
import { enqueueSpeechDetect } from "./speech-detect";
import { getPostState } from "./state";
import { buildTimeline } from "./timeline";
import { enqueueVoiceJob, runVoiceJob } from "./voice-job";
import { readCurrentVoice, writeVoiceConfig } from "./voices";

const EP = "e01";
/** Реплика в поддельном ответе: тишина LEAD, звук TONE на реплику, тишина GAP между ними. */
const LEAD = 0.3;
const TONE = 0.8;
const GAP = 1.0;

type Seen = { url: string; key?: string; body: Record<string, unknown> };
/** Запросы озвучки (text-to-speech). */
const seen: Seen[] = [];
/** Запросы Voice Isolator: имя поля и файла из multipart. */
const isolationSeen: { key?: string; field: string; filename: string; bytes: number; seconds: number }[] = [];
let isolationFails = false;

/** Поддельный Voice Isolator: вынимает файл из multipart и отдаёт его тише и в mp3 (как «очищенный»). */
async function fakeIsolation(raw: Buffer, contentType: string): Promise<{ field: string; filename: string; mp3: Buffer; seconds: number }> {
  const boundary = contentType.match(/boundary=(.+)$/)![1];
  const text = raw.toString("latin1");
  const head = text.match(/name="([^"]+)"; filename="([^"]+)"/)!;
  const start = text.indexOf("\r\n\r\n", text.indexOf(head[0])) + 4;
  const end = text.lastIndexOf(`\r\n--${boundary}`);
  const input = path.join(tmp, `iso-in-${isolationSeen.length}.wav`);
  const output = path.join(tmp, `iso-out-${isolationSeen.length}.mp3`);
  fs.writeFileSync(input, raw.subarray(start, end));
  const { execFileSync } = await import("node:child_process");
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", input]).toString());
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-af", "volume=0.5", "-c:a", "libmp3lame", output]);
  return { field: head[1], filename: head[2], mp3: fs.readFileSync(output), seconds };
}
let server: http.Server;
let requestNumber = 0;

/** Поддельный /with-timestamps: тон на каждую реплику (разделитель — <break> или пустая строка) и таймстемпы символов. */
async function fakeTts(text: string): Promise<{ audio: Buffer; alignment: unknown }> {
  const separators = [lineSeparator("eleven_multilingual_v2"), lineSeparator("eleven_v3")];
  const parts: { from: number; to: number }[] = [];
  let cursor = 0;
  while (cursor <= text.length) {
    let next = -1;
    let sepLength = 0;
    for (const sep of separators) {
      const at = text.indexOf(sep, cursor);
      if (at >= 0 && (next < 0 || at < next)) {
        next = at;
        sepLength = sep.length;
      }
    }
    parts.push({ from: cursor, to: next < 0 ? text.length : next });
    if (next < 0) break;
    cursor = next + sepLength;
  }
  const spans = parts.map((part, index) => ({ ...part, start: LEAD + index * (TONE + GAP), end: LEAD + index * (TONE + GAP) + TONE }));
  const duration = spans[spans.length - 1].end + 0.5;
  const expr = spans.map((span) => `between(t,${span.start},${span.end})*0.5*sin(2*PI*440*t)`).join("+");
  const file = path.join(tmp, `fake-${requestNumber}.mp3`);
  await synthesizeMedia(file, { duration, expr, codec: "libmp3lame" });
  const characters = [...text];
  const starts: number[] = [];
  const ends: number[] = [];
  characters.forEach((_, index) => {
    const span = spans.find((item) => index >= item.from && index < item.to);
    if (span) {
      const step = (span.end - span.start) / Math.max(1, span.to - span.from);
      // Таймстемп конца чуть раньше конца звука: так у ElevenLabs (затухание не входит).
      starts.push(span.start + step * (index - span.from));
      ends.push(Math.min(span.end - 0.1, span.start + step * (index - span.from + 1)));
    } else {
      const last = ends[ends.length - 1] ?? 0;
      starts.push(last);
      ends.push(last);
    }
  });
  return {
    audio: fs.readFileSync(file),
    alignment: { characters, character_start_times_seconds: starts, character_end_times_seconds: ends },
  };
}

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      if (req.url === "/v1/audio-isolation") {
        if (isolationFails) {
          res.writeHead(500);
          return res.end("isolation is down");
        }
        const { field, filename, mp3, seconds } = await fakeIsolation(Buffer.concat(chunks), String(req.headers["content-type"]));
        // Как настоящий Voice Isolator: звук короче 4.6 с не принимается.
        if (seconds < 4.6) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ detail: { code: "audio_too_short", message: `Audio duration is ${seconds} seconds` } }));
        }
        isolationSeen.push({ key: req.headers["xi-api-key"] as string | undefined, field, filename, bytes: mp3.length, seconds });
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        return res.end(mp3);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(raw || "{}") as Record<string, unknown>;
      seen.push({ url: req.url || "", key: req.headers["xi-api-key"] as string | undefined, body });
      if (!/^\/v1\/text-to-speech\/[^/]+\/with-timestamps/.test(req.url || "")) {
        res.writeHead(404);
        return res.end();
      }
      requestNumber += 1;
      const { audio, alignment } = await fakeTts(String(body.text));
      res.writeHead(200, { "Content-Type": "application/json", "request-id": `req-${requestNumber}` });
      res.end(JSON.stringify({ audio_base64: audio.toString("base64"), alignment, normalized_alignment: alignment }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ELEVENLABS_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  createEpisode(EP);
  fs.mkdirSync(path.join(getCharactersRoot(), "Julia"), { recursive: true });
  fs.mkdirSync(path.join(getCharactersRoot(), "Lena"), { recursive: true });
  const shot = (id: string, characters: string, speech?: string) => {
    fs.mkdirSync(path.join(stageDir(EP, id, "final_render"), "approve"), { recursive: true });
    fs.writeFileSync(path.join(shotDir(EP, id), "shot.md"), `# ${id}\n\n- characters: ${characters}\n- location: room\n`);
    if (speech) fs.writeFileSync(path.join(shotDir(EP, id), "speech.md"), speech);
  };
  // s01 — Wan без речи; s02 — H3 со своим звуком (речь 0.5–1.5 и 2.5–3.2); s03 — Wan 16 fps без звука.
  shot("s01", "Lena");
  shot("s02", "Julia, Lena", "julia: Don't mind him.\nLena: But why?\n");
  shot("s03", "Julia", "Everybody wants it. I am Julia, by the way.\n");
  const { execFileSync } = await import("node:child_process");
  const video = async (id: string, name: string, options: Parameters<typeof synthesizeMedia>[1], withAudio: boolean) => {
    const target = path.join(stageDir(EP, id, "final_render"), "approve", name);
    if (withAudio) return synthesizeMedia(target, options);
    // Wan: видео без аудиодорожки.
    const temp = path.join(tmp, `${id}_tmp.mp4`);
    await synthesizeMedia(temp, options);
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", temp, "-an", "-c:v", "copy", target]);
  };
  await video("s01", "s01_wan.mp4", { duration: 2, expr: "0", video: { width: 720, height: 1280, fps: 24 } }, false);
  await video(
    "s02",
    "s02_h3.mp4",
    {
      duration: 4,
      expr: "(between(t,0.5,1.5)+between(t,2.5,3.2))*0.5*sin(2*PI*300*t)",
      video: { width: 768, height: 1344, fps: 24 },
      codec: "aac",
    },
    true,
  );
  await video("s03", "s03_wan.mp4", { duration: 3, expr: "0", video: { width: 720, height: 1280, fps: 16 } }, false);
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("реплики из speech.md: порядок кадров, персонажи по библиотеке, места по звуку финала или подряд", async () => {
  const { lines } = await readPostLines(EP);
  assert.deepEqual(
    lines.map((line) => [line.id, line.order, line.character, line.text]),
    [
      ["s02-1", 1, "Julia", "Don't mind him."],
      ["s02-2", 2, "Lena", "But why?"],
      ["s03-1", 3, "Julia", "Everybody wants it. I am Julia, by the way."],
    ],
  );
  // s02: звук финала — реплики на его отрезках.
  assert.ok(Math.abs(lines[0].at - 0.5) < 0.06, `s02-1 at ${lines[0].at}`);
  assert.ok(Math.abs(lines[1].at - 2.5) < 0.06, `s02-2 at ${lines[1].at}`);
  // s03: звука нет — с начала кадра с отступом.
  assert.equal(lines[2].at, 0.3);
  assert.equal(fs.existsSync(linesFile(EP)), false, "чтение ничего не пишет");
});

test("без галочки разрешения в ElevenLabs ничего не уходит", async () => {
  // Склейку запросов проверяем на v2: у v3 её нет.
  writeVoiceConfig("julia", { voice_id: "voiceJulia01", model_id: "eleven_multilingual_v2", seed: 7, voice_settings: { stability: 0.6 } });
  await assert.rejects(enqueueVoiceJob(EP, { characters: ["Julia"] }), /Разрешить платную отправку в ElevenLabs/);
  await assert.rejects(enqueueVoiceJob(EP, { characters: ["Julia"], allowPaid: false }), /Разрешить платную/);
  await assert.rejects(enqueueVoiceJob(EP, { characters: ["Lena"], allowPaid: true }), /нет voice.json/);
  assert.equal(seen.length, 0);
  const config = JSON.parse(fs.readFileSync(path.join(getCharactersRoot(), "Julia", "voice.json"), "utf8"));
  assert.deepEqual(config, {
    voice_id: "voiceJulia01",
    model_id: "eleven_multilingual_v2",
    text_prefix: "[strong Russian accent]",
    isolate: true,
    voice_settings: { stability: 0.6 },
    seed: 7,
  });
});

test("озвучка персонажа: два куска склеены через previous_request_ids, один wav, границы реплик по звуку", async () => {
  const state = await getPostState(EP);
  const julia = state.characters.find((item) => item.name === "Julia")!;
  assert.ok(julia.chars > 0, "оценка стоимости в символах");

  const job = await enqueueVoiceJob(EP, { characters: ["Julia"], allowPaid: true });
  assert.equal(job.chars, julia.chars);
  const done = await runVoiceJob(EP, job.id);
  assert.equal(done.status, "done", done.error);
  assert.deepEqual(done.results, [{ character: "Julia", version: 1, isolation: "done" }]);

  // Лимит 60 символов: две реплики Julia не влезают в один запрос.
  assert.equal(seen.length, 2);
  assert.equal(seen[0].key, "test-key");
  assert.match(seen[0].url, /\/v1\/text-to-speech\/voiceJulia01\/with-timestamps\?output_format=mp3_44100_128/);
  assert.equal(seen[0].body.text, "[strong Russian accent] Don't mind him.", "тег персонажа перед фразой");
  assert.equal(seen[1].body.text, "[strong Russian accent] Everybody wants it. I am Julia, by the way.");
  assert.equal(seen[0].body.text_prefix, undefined, "поле voice.json в запрос не уходит");
  assert.equal(seen[0].body.model_id, "eleven_multilingual_v2");
  assert.equal(seen[0].body.seed, 7);
  assert.equal(seen[0].body.previous_request_ids, undefined);
  assert.deepEqual(seen[1].body.previous_request_ids, ["req-1"]);

  // Очистка включена по умолчанию: склейка ушла в Voice Isolator одним файлом, в работе — очищенный wav.
  assert.equal(isolationSeen.length, 1);
  assert.deepEqual([isolationSeen[0].key, isolationSeen[0].field, isolationSeen[0].filename], ["test-key", "audio", "v1.raw.wav"]);
  assert.ok(job.isolationChars! > 0, "в оценке стоимости есть очистка");

  const voice = readCurrentVoice(EP, "Julia")!;
  assert.equal(voice.file, "v1.wav");
  assert.equal(voice.rawFile, "v1.raw.wav");
  assert.equal(voice.isolation?.status, "done");
  assert.ok(fs.existsSync(path.join(voicesDir(EP, "Julia"), "v1.isolated.mp3")), "ответ Voice Isolator сохранён как есть");
  const rawLength = (await probeMedia(path.join(voicesDir(EP, "Julia"), "v1.raw.wav"))).duration;
  const cleanLength = (await probeMedia(path.join(voicesDir(EP, "Julia"), "v1.wav"))).duration;
  assert.ok(Math.abs(rawLength - cleanLength) < 0.001, `очищенный файл той же длины: ${rawLength} / ${cleanLength}`);
  assert.ok(fs.existsSync(path.join(voicesDir(EP, "Julia"), "v1.wav")));
  assert.ok(fs.existsSync(path.join(voicesDir(EP, "Julia"), "v1.part2.mp3")));
  assert.equal(voice.chunks.length, 2);
  // Второй кусок идёт после первого и секунды тишины.
  const second = voice.chunks[1];
  assert.ok(Math.abs(second.offset - (voice.chunks[0].duration + 1)) < 0.01);
  const [first, next] = voice.lines;
  assert.ok(Math.abs(first.speechStart - LEAD) < 0.08, `начало звука ${first.speechStart}`);
  assert.ok(Math.abs(first.speechEnd - (LEAD + TONE)) < 0.08, `конец звука по тишине ${first.speechEnd}, а не по таймстемпу`);
  assert.ok(Math.abs(next.speechStart - (second.offset + LEAD)) < 0.08, `вторая реплика ${next.speechStart}`);
  assert.ok(first.in < first.speechStart && first.out > first.speechEnd, "запас вокруг звука");
  assert.ok(first.out <= next.in, "отрезки не перекрываются");
});

test("таймлайн: видео по порядку, звук финала выключен, дорожка на персонажа, клипы — отрезки длинного файла", async () => {
  const manifest = await buildTimeline(EP);
  assert.equal(manifest.timeline, "timeline/e01_v1.fcpxml");
  assert.deepEqual(
    manifest.shots.map((shot) => [shot.shotId, shot.start, shot.duration, shot.hasAudio]),
    [
      ["s01", 0, 2, false],
      ["s02", 2, 4, true],
      ["s03", 6, 3, false],
    ],
  );
  assert.deepEqual(manifest.characters, [{ name: "Julia", lane: -2 }]);
  assert.deepEqual(manifest.skipped, [{ id: "s02-2", reason: "нет озвучки Lena" }]);
  assert.ok(manifest.warnings.some((text) => text.startsWith("s03: финал 16 fps")));
  const [julia1, julia2] = manifest.lines;
  // Речь начинается в месте `at` кадра (с точностью до кадра 1/24).
  const voice = readCurrentVoice(EP, "Julia")!;
  const speechAt = (line: typeof julia1, index: number) => line.timelineStart + (voice.lines[index].speechStart - line.sourceIn);
  assert.ok(Math.abs(speechAt(julia1, 0) - (2 + julia1.at)) <= 1 / 24 + 1e-6);
  assert.ok(Math.abs(speechAt(julia2, 1) - (6 + 0.3)) <= 1 / 24 + 1e-6);
  assert.equal(julia1.source, "voices/Julia/v1.wav");
  assert.equal(julia2.source, julia1.source, "оба клипа — из одного файла");

  const xml = fs.readFileSync(path.join(timelineDir(EP), "e01_v1.fcpxml"), "utf8");
  assertWellFormed(xml);
  assert.match(xml, /<fcpxml version="1\.9">/);
  assert.match(xml, /<format id="r1" frameDuration="1\/24s" width="720" height="1280"\/>/);
  assert.match(xml, /frameDuration="1\/16s" width="720" height="1280"/);
  const spine = [...xml.matchAll(/^ {8}<asset-clip ref="(a\d+)" offset="([^"]+)"[^>]*name="(s\d+)" srcEnable="video"/gm)];
  assert.deepEqual(spine.map((m) => [m[2], m[3]]), [["0s", "s01"], ["48/24s", "s02"], ["144/24s", "s03"]]);
  assert.match(xml, /lane="-1" offset="0s" start="0s" duration="96\/24s" name="s02 звук финала" srcEnable="audio" enabled="0"/);
  const voices = [...xml.matchAll(/<asset-clip ref="(a\d+)" lane="-2" offset="(\d+\/24s|0s)" start="(\d+\/24s|0s)" duration="(\d+)\/24s"/g)];
  assert.equal(voices.length, 2);
  assert.equal(voices[0][1], voices[1][1], "один ассет wav на персонажа");
  assert.match(xml, /<media-rep kind="original-media" src="file:\/\/\/.+\/voices\/Julia\/v1\.wav"\/>/);
  assert.ok(fs.existsSync(manifestFile(EP)));

  // Проект Kdenlive той же сборки.
  assert.equal(manifest.kdenlive, "timeline/e01_v1.kdenlive");
  const kd = fs.readFileSync(path.join(timelineDir(EP), "e01_v1.kdenlive"), "utf8");
  assertWellFormed(kd);
  assert.match(kd, /<profile [^>]*width="720" height="1280"[^>]*frame_rate_num="24"/);
  assert.match(kd, /<property name="kdenlive:docproperties.version">1.1<\/property>/);
  assert.match(kd, /<property name="kdenlive:projectTractor">1<\/property>/);
  // Видео: s01, s02, s03 подряд без пустот (48 + 96 + 72 кадра).
  const video = kd.match(/<playlist id="playlist_video">([\s\S]*?)<\/playlist>/)![1];
  assert.deepEqual([...video.matchAll(/<entry producer="(\w+)" in="(\d+)" out="(\d+)"/g)].map((m) => Number(m[3]) - Number(m[2]) + 1), [48, 96, 72]);
  assert.ok(!video.includes("<blank"));
  // Звук финала — выключенная дорожка; голос Julia — отрезки одного wav.
  assert.match(kd, /<tractor id="tractor_final_audio"[\s\S]*?<track hide="both" producer="playlist_final_audio"\/>/);
  const juliaTrack = kd.match(/<playlist id="playlist_voice0">([\s\S]*?)<\/playlist>/)![1];
  const entries = [...juliaTrack.matchAll(/<entry producer="(\w+)" in="(\d+)" out="(\d+)"/g)];
  assert.equal(entries.length, 2);
  assert.equal(entries[0][1], entries[1][1], "один источник на персонажа");
  assert.equal(Number(entries[0][2]), julia1.sourceIn * 24);
  const firstBlank = Number(juliaTrack.match(/<blank length="(\d+)"\/>/)![1]);
  assert.equal(firstBlank, julia1.timelineStart * 24, "реплика стоит на своём месте");
  assert.match(kd, /voices\/Julia\/v1\.wav<\/property>/);
  // Каждая реплика — с нарастанием и затуханием по 2 кадра (эффекты Kdenlive fadein/fadeout), чтобы не щёлкало.
  const firstEntry = juliaTrack.match(/<entry producer="\w+" in="(\d+)" out="(\d+)">[\s\S]*?<\/entry>/)!;
  const [inPoint, outPoint] = [Number(firstEntry[1]), Number(firstEntry[2])];
  assert.match(firstEntry[0], new RegExp(`<filter id="[^"]+_fadein" in="${inPoint}" out="${inPoint + 1}">[\\s\\S]*?"kdenlive_id">fadein<[\\s\\S]*?"gain">0<[\\s\\S]*?"end">1<`));
  assert.match(firstEntry[0], new RegExp(`<filter id="[^"]+_fadeout" in="${outPoint - 1}" out="${outPoint}">[\\s\\S]*?"kdenlive_id">fadeout<[\\s\\S]*?"gain">1<[\\s\\S]*?"end">0<`));
  assert.ok(!video.includes("fadein"), "у видео затуханий нет");

  // Повторная сборка — новая версия, старая остаётся.
  await buildTimeline(EP, { width: 1080, height: 1920 });
  assert.deepEqual(fs.readdirSync(timelineDir(EP)).sort(), ["e01_v1.fcpxml", "e01_v1.kdenlive", "e01_v2.fcpxml", "e01_v2.kdenlive"]);
});

test("перегенерация персонажа: новая версия, ручные место и подрезка сохраняются; изменённый текст их сбрасывает", async () => {
  await updatePostLine(EP, "s02-1", { at: 0.7, trimIn: -0.05, trimOut: 0.1 });
  await updatePostLine(EP, "s03-1", { trimOut: 0.2 });
  const job = await enqueueVoiceJob(EP, { characters: ["Julia"], allowPaid: true });
  const done = await runVoiceJob(EP, job.id);
  assert.equal(done.status, "done", done.error);
  const voice = readCurrentVoice(EP, "Julia")!;
  assert.equal(voice.version, 2);
  assert.ok(fs.existsSync(path.join(voicesDir(EP, "Julia"), "v1.wav")), "старая версия не удалена");

  let { lines } = await collectPost(EP);
  const line = lines.find((item) => item.id === "s02-1")!;
  assert.equal(line.at, 0.7);
  assert.equal(line.atManual, true);
  assert.equal(line.trimIn, -0.05);
  assert.equal(line.clip!.version, 2);
  assert.ok(Math.abs(line.clip!.in - (line.clip!.autoIn - 0.05)) < 1e-6);
  assert.ok(Math.abs(line.clip!.out - (line.clip!.autoOut + 0.1)) < 1e-6);

  // Тег не попадает в текст реплик и манифест.
  assert.ok(lines.every((item) => !item.text.includes("[strong")));
  // Модель по умолчанию — v3: пустая строка между репликами и previous_text вместо previous_request_ids.
  // Пустой тег — фраза уходит как есть.
  writeVoiceConfig("Julia", { voice_id: "voiceJulia01", text_prefix: "" });
  assert.equal(JSON.parse(fs.readFileSync(path.join(getCharactersRoot(), "Julia", "voice.json"), "utf8")).model_id, "eleven_v3");
  const before = seen.length;
  const plain = await runVoiceJob(EP, (await enqueueVoiceJob(EP, { characters: ["Julia"], allowPaid: true })).id);
  assert.equal(plain.status, "done", plain.error);
  // Без <break> и тега обе реплики влезают в лимит 60: один запрос, реплики через пустую строку.
  assert.equal(seen.length, before + 1);
  assert.equal(seen[before].body.text, "Don't mind him.\n\nEverybody wants it. I am Julia, by the way.");
  assert.equal(seen[before].body.previous_request_ids, undefined);

  // Текст реплики изменился в speech.md: подрезка сброшена, озвучка устарела, место осталось.
  fs.writeFileSync(path.join(shotDir(EP, "s03"), "speech.md"), "Everybody wants it.\n");
  ({ lines } = await collectPost(EP));
  const changed = lines.find((item) => item.id === "s03-1")!;
  assert.equal(changed.trimOut, 0);
  assert.equal(changed.voice, "stale");
  const state = await getPostState(EP);
  assert.equal(state.characters.find((item) => item.name === "Julia")!.pending, 1);
});

test("речь в финале (Whisper): реплика встаёт под губы, скорость под длину речи, в Kdenlive — timewarp без смены тона", async () => {
  // Распознавание ставится только кадрам со своим звуком в финале (s02 — H3), задание — с текстовыми выходами.
  const { queued, skipped } = await enqueueSpeechDetect(EP);
  assert.deepEqual(queued, ["s02"]);
  assert.deepEqual(skipped.map((item) => [item.shotId, item.reason]), [
    ["s01", "в финале нет звука"],
    ["s03", "в финале нет звука"],
  ]);
  const jobName = fs.readdirSync(getComfyQueueRoot()).find((name) => name.startsWith("post-speech-e01-s02-"))!;
  const job = readComfyJob(jobName.replace(/\.json$/, ""))!;
  assert.equal(job.saveText, true);
  assert.equal(job.uploads![0].filename, "fb_e01_s02_s02_h3.mp4");
  assert.equal(job.prompt["46"].inputs.video, "fb_e01_s02_s02_h3.mp4", "видео финала подставлено в VHS_LoadVideo");
  assert.equal(job.prompt["47"].class_type, "Apply Whisper");
  assert.deepEqual((await enqueueSpeechDetect(EP)).queued, [], "повторно не ставится, пока идёт");

  // Ответ ComfyUI: очередь сохранила текст нод файлами (98 — слова, 92 — текст).
  const words = [
    { value: "Don't", start: 0.62, end: 0.8 },
    { value: "mind", start: 0.8, end: 0.95 },
    { value: "him.", start: 0.95, end: 1.22 },
    { value: "But", start: 2.5, end: 2.7 },
    { value: "why?", start: 2.7, end: 3.2 },
  ];
  const saveDir = path.resolve(process.cwd(), job.saveTo);
  fs.mkdirSync(saveDir, { recursive: true });
  fs.writeFileSync(path.join(saveDir, "98.txt"), JSON.stringify(words));
  fs.writeFileSync(path.join(saveDir, "92.txt"), "Don't mind him. But why?");
  fs.writeFileSync(path.join(getComfyQueueRoot(), jobName), JSON.stringify({ ...job, status: "done", files: ["92.txt", "98.txt"] }));

  await updatePostLine(EP, "s02-1", { at: null });
  let { lines } = await collectPost(EP);
  let julia = lines.find((item) => item.id === "s02-1")!;
  assert.deepEqual(julia.window && [julia.window.start, julia.window.end], [0.62, 1.22]);
  assert.equal(julia.at, 0.62, "речь начинается там, где начинают говорить губы");
  const speech = julia.clip!.speechEnd - julia.clip!.speechStart;
  assert.equal(julia.clip!.speed, Math.round(Math.min(1.35, Math.max(0.8, speech / 0.6)) * 100) / 100);
  assert.ok(julia.clip!.speed > 1, `озвучка ${speech} с длиннее губ 0.6 с — быстрее`);
  assert.equal(lines.find((item) => item.id === "s02-2")!.window!.start, 2.5);

  // Ручная скорость перекрывает подгонку, null возвращает авто.
  await updatePostLine(EP, "s02-1", { speed: 1.1 });
  ({ lines } = await collectPost(EP));
  assert.equal(lines.find((item) => item.id === "s02-1")!.clip!.speed, 1.1);
  await updatePostLine(EP, "s02-1", { speed: null });
  ({ lines } = await collectPost(EP));
  julia = lines.find((item) => item.id === "s02-1")!;

  const manifest = await buildTimeline(EP);
  const line = manifest.lines.find((item) => item.id === "s02-1")!;
  assert.equal(line.speed, julia.clip!.speed);
  assert.deepEqual(line.window, { start: 0.62, end: 1.22 });
  // Начало речи на таймлайне — начало кадра s02 (2 с) + 0.62, с точностью до кадра.
  const speechAt = line.timelineStart + (julia.clip!.speechStart - line.sourceIn) / line.speed;
  assert.ok(Math.abs(speechAt - 2.62) <= 1 / 24 + 1e-6, `речь на ${speechAt}`);
  assert.ok(manifest.warnings.some((text) => text.includes("только в проекте Kdenlive")));

  const kd = fs.readFileSync(path.join(timelineDir(EP), manifest.kdenlive!.replace("timeline/", "")), "utf8");
  assertWellFormed(kd);
  const twId = `_tw${Math.round(line.speed * 100)}`;
  const tw = kd.match(new RegExp(`<producer id="(chain\\d+${twId})"[\\s\\S]*?</producer>`))!;
  assert.match(tw[0], /<property name="mlt_service">timewarp<\/property>/);
  assert.match(tw[0], /<property name="warp_pitch">1<\/property>/);
  assert.match(tw[0], new RegExp(`<property name="resource">${line.speed}:.+voices/Julia/v\\d+\\.wav</property>`));
  const entry = kd.match(new RegExp(`<entry producer="${tw[1]}" in="(\\d+)" out="(\\d+)"`))!;
  const sourceFrames = Math.round((line.sourceOut - line.sourceIn) * 24);
  assert.equal(Number(entry[2]) - Number(entry[1]) + 1, Math.round(sourceFrames / line.speed), "на таймлайне клип короче в speed раз");

  // Финал заменили — распознавание устарело, рамки нет до нового прогона.
  const final = path.join(stageDir(EP, "s02", "final_render"), "approve", "s02_h3.mp4");
  fs.appendFileSync(final, Buffer.from([0]));
  ({ lines } = await collectPost(EP));
  assert.equal(lines.find((item) => item.id === "s02-1")!.window, null);
  assert.equal((await getPostState(EP)).shots.find((shot) => shot.shotId === "s02")!.speech.status, "stale");
});

test("«Собрать проект» сам распознаёт речь там, где её нет, и не ждёт выключенный ComfyUI", async () => {
  // После прошлого теста финал s02 заменён — распознавание устарело. ComfyUI в тестах нет: задание не уйдёт.
  const before = fs.readdirSync(getComfyQueueRoot()).filter((name) => name.startsWith("post-speech-e01-s02-")).length;
  const started = Date.now();
  const manifest = await buildProject(EP, { stallMs: 300, pollMs: 50 });
  assert.ok(Date.now() - started < 10_000, "не висит");
  const after = fs.readdirSync(getComfyQueueRoot()).filter((name) => name.startsWith("post-speech-e01-s02-")).length;
  assert.equal(after, before + 1, "распознавание s02 поставлено заново");
  assert.match(manifest.warnings[0], /^s02: распознавание речи не ушло в ComfyUI/);
  assert.ok(fs.existsSync(path.join(timelineDir(EP), manifest.kdenlive!.replace("timeline/", ""))), "проект собран");
});

test("Voice Isolator: сбой не теряет оплаченную озвучку; готовую озвучку можно очистить отдельно", async () => {
  // Очистка упала — озвучка в работе, в проекте исходный звук, ошибка видна в задании и версии.
  isolationFails = true;
  let job = await runVoiceJob(EP, (await enqueueVoiceJob(EP, { characters: ["Julia"], allowPaid: true })).id);
  isolationFails = false;
  assert.equal(job.status, "done", job.error);
  assert.equal(job.results[0].isolation, "error");
  assert.match(job.results[0].isolationError!, /Voice Isolator: HTTP 500/);
  let voice = readCurrentVoice(EP, "Julia")!;
  assert.equal(voice.isolation?.status, "error");
  assert.equal(voice.file, voice.rawFile, "в работе исходник");

  // Без галочки очистка не ставится.
  const sent = isolationSeen.length;
  await assert.rejects(enqueueVoiceJob(EP, { characters: ["Julia"], kind: "isolate" }), /Разрешить платную отправку/);
  assert.equal(isolationSeen.length, sent);

  // «Очистить голос»: та же версия, новый файл, исходник остаётся.
  job = await runVoiceJob(EP, (await enqueueVoiceJob(EP, { characters: ["Julia"], allowPaid: true, kind: "isolate" })).id);
  assert.equal(job.status, "done", job.error);
  assert.equal(job.kind, "isolate");
  assert.equal(job.chars, 0, "текст в ElevenLabs не уходит");
  assert.ok(job.isolationChars! > 0);
  assert.equal(isolationSeen.length, sent + 1);
  const cleaned = readCurrentVoice(EP, "Julia")!;
  assert.equal(cleaned.version, voice.version);
  assert.equal(cleaned.file, `v${voice.version}.clean.wav`);
  assert.equal(cleaned.rawFile, voice.file);
  assert.equal(cleaned.isolation?.status, "done");
  const { lines } = await collectPost(EP);
  assert.ok(lines.find((item) => item.id === "s02-1")!.clip!.source.endsWith(`v${voice.version}.clean.wav`), "в проект идёт очищенный звук");
  await assert.rejects(enqueueVoiceJob(EP, { characters: ["Julia"], allowPaid: true, kind: "isolate" }), /уже очищена/);

  // Короткая озвучка (меньше 4.6 с) уходит дополненной тишиной, очищенный файл — исходной длины.
  const shortSeen = isolationSeen.find((item) => item.seconds >= 4.6 && item.seconds < 5.1);
  assert.ok(shortSeen, `короткая озвучка дополнена до 5 с: ${isolationSeen.map((item) => item.seconds).join(", ")}`);
  const cleanedLength = (await probeMedia(path.join(voicesDir(EP, "Julia"), cleaned.file))).duration;
  assert.ok(Math.abs(cleanedLength - cleaned.duration) < 0.001, `очищенный — исходной длины ${cleaned.duration}: ${cleanedLength}`);
  assert.ok(!fs.readdirSync(voicesDir(EP, "Julia")).some((name) => name.includes(".padded.")), "временный файл удалён");

  // Очистка выключена в voice.json — Voice Isolator не вызывается.
  writeVoiceConfig("Julia", { voice_id: "voiceJulia01", isolate: false });
  job = await runVoiceJob(EP, (await enqueueVoiceJob(EP, { characters: ["Julia"], allowPaid: true })).id);
  voice = readCurrentVoice(EP, "Julia")!;
  assert.equal(job.isolationChars, 0);
  assert.equal(isolationSeen.length, sent + 1);
  assert.equal(voice.isolation?.status, "off");
  assert.equal(voice.file, `v${voice.version}.wav`);
});

test("музыка: сборка оставляет пустую дорожку «Музыка», вставка заполняет её по кругу и заменяет себя при повторе", async () => {
  const manifest = await buildTimeline(EP);
  const file = path.join(timelineDir(EP), manifest.kdenlive!.replace("timeline/", ""));
  const built = fs.readFileSync(file, "utf8");
  // Пустая нижняя дорожка — первая после чёрной.
  assert.match(built, /<track producer="black_track"\/>\s*<track producer="tractor_music"\/>/);
  assert.match(built, /<tractor id="tractor_music"[\s\S]*?"kdenlive:track_name">Музыка</);
  assert.ok(!built.match(/<playlist id="playlist_music">[\s\S]*?<\/playlist>/)![0].includes("<entry"));

  const total = Math.round(manifest.duration * 24);
  const theme = { file: "C:\\music\\theme.mp3", frames: 96, label: "Музыка: theme.mp3" };
  const once = insertMusic(built, [theme], total, "0=-60;24=-18");
  assertWellFormed(once);
  const playlist = once.match(/<playlist id="playlist_music">([\s\S]*?)<\/playlist>/)![1];
  const entries = [...playlist.matchAll(/<entry producer="(\w+)" in="(\d+)" out="(\d+)"/g)];
  assert.equal(entries.reduce((sum, entry) => sum + Number(entry[3]) - Number(entry[2]) + 1, 0), total, "до конца проекта");
  assert.ok(entries.length >= 3, "файл короче проекта — по кругу");
  assert.ok(entries.every((entry) => entry[1] === "frameboard_music0_audio"));
  assert.match(playlist, /"kdenlive:audio_track">1</, "свойства дорожки на месте");
  assert.ok(once.indexOf('<chain id="frameboard_music0_audio"') < once.indexOf('<playlist id="playlist_music">'), "клип определён до использования");
  assert.match(once, /<property name="resource">C:\/music\/theme\.mp3<\/property>/);
  assert.match(once.slice(once.indexOf('<playlist id="main_bin"')), /<entry producer="frameboard_music0" in="0" out="95"\/>/);
  const ids = [...once.matchAll(/<property name="kdenlive:id">(\d+)<\/property>/g)].map((m) => Number(m[1]));
  const musicId = Number(once.match(/<chain id="frameboard_music0"[\s\S]*?"kdenlive:id">(\d+)</)![1]);
  assert.equal(musicId, Math.max(...ids.filter((id) => id !== musicId)) + 1, "новый kdenlive:id");
  const tractor = once.match(/<tractor id="tractor_music"[\s\S]*?<\/tractor>/)![0];
  assert.match(tractor, /"kdenlive_id">volume<[\s\S]*"level">0=-60;24=-18</);

  // Повтор: своя музыка заменяется, громкость не удваивается.
  const twice = insertMusic(once, [theme], total, "0=-60;24=-20");
  assertWellFormed(twice);
  assert.equal(twice.match(/<chain id="frameboard_music0"/g)!.length, 1);
  assert.equal(twice.match(/<entry producer="frameboard_music0" /g)!.length, 1);
  const tractor2 = twice.match(/<tractor id="tractor_music"[\s\S]*?<\/tractor>/)![0];
  assert.equal(tractor2.match(/"kdenlive_id">volume</g)!.length, 1);
  assert.match(tractor2, /"level">0=-60;24=-20</);
  assert.equal(twice.match(/<tractor id="tractor_music"/g)!.length, 1);

  // Нет дорожки «Музыка» (старый проект) — создаётся внизу и заполняется.
  const old = insertMusic(built.replace(/Музыка/g, "Music"), [theme], total, "0=-18");
  assertWellFormed(old);
  assert.match(old, /<track producer="black_track"\/>\s*<track producer="frameboard_music_tractor"\/>/);
  assert.match(old.match(/<playlist id="frameboard_music_playlist">[\s\S]*?<\/playlist>/)![0], /<entry producer="frameboard_music0_audio"/);
  assert.ok(MusicTrackMissingError);
});

test("скрытый с таблицы кадр не идёт в пост: ни реплик, ни распознавания, ни кадра, ни пустоты", async () => {
  setShotHidden(EP, "s02", true);
  try {
    const { lines } = await readPostLines(EP);
    assert.ok(!lines.some((line) => line.shotId === "s02"), "реплик скрытого кадра нет");
    assert.deepEqual(lines.map((line) => line.order), lines.map((_, index) => index + 1), "номера реплик — подряд");
    const { queued, skipped } = await enqueueSpeechDetect(EP, { force: true });
    assert.ok(!queued.includes("s02") && !skipped.some((item) => item.shotId === "s02"), "речь скрытого кадра не распознаётся");

    const manifest = await buildTimeline(EP);
    assert.deepEqual(manifest.shots.map((shot) => shot.shotId), ["s01", "s03"]);
    assert.equal(manifest.shots[1].start, manifest.shots[0].start + manifest.shots[0].duration, "следующий кадр — вплотную");
    assert.ok(!manifest.lines.some((line) => line.shotId === "s02"));
    assert.ok(!manifest.skipped.some((item) => item.id.startsWith("s02-")));
    const kd = fs.readFileSync(path.join(timelineDir(EP), manifest.kdenlive!.replace("timeline/", "")), "utf8");
    const video = kd.match(/<playlist id="playlist_video">([\s\S]*?)<\/playlist>/)![1];
    assert.ok(!video.includes("<blank"), "в видео нет пустоты");
    assert.equal([...video.matchAll(/<entry /g)].length, 2);
    assert.ok(!kd.includes("s02_h3.mp4"), "финал скрытого кадра в проект не попал");
  } finally {
    setShotHidden(EP, "s02", false);
  }
});

test("имена из сценария: назначаются персонажу библиотеки, два имени — один голос; можно запомнить для всех эпизодов", async () => {
  fs.mkdirSync(path.join(getCharactersRoot(), "ba"), { recursive: true });
  fs.mkdirSync(path.join(getCharactersRoot(), "militsiya_officer_young"), { recursive: true });
  const speechFile = path.join(shotDir(EP, "s01"), "speech.md");
  fs.writeFileSync(speechFile, "BABUSHKA: Where are you going?\nMALE VOICE: Stop right there.\nMILITSIONER: Documents, please.\n");
  try {
    let { lines } = await readPostLines(EP);
    let s01 = lines.filter((line) => line.shotId === "s01");
    assert.deepEqual(s01.map((line) => [line.speaker, line.character]), [
      ["BABUSHKA", "BABUSHKA"],
      ["MALE VOICE", "MALE VOICE"],
      ["MILITSIONER", "MILITSIONER"],
    ], "без назначения — как в сценарии");

    assignSpeaker(EP, "BABUSHKA", "BA");
    assignSpeaker(EP, "male voice", "militsiya_officer_young");
    assignSpeaker(EP, "MILITSIONER", "militsiya_officer_young");
    ({ lines } = await readPostLines(EP));
    s01 = lines.filter((line) => line.shotId === "s01");
    assert.deepEqual(s01.map((line) => line.character), ["ba", "militsiya_officer_young", "militsiya_officer_young"]);
    assert.deepEqual(s01.map((line) => line.text), ["Where are you going?", "Stop right there.", "Documents, please."], "текст не меняется");
    const state = await getPostState(EP);
    const officer = state.characters.find((item) => item.name === "militsiya_officer_young")!;
    assert.equal(officer.lines, 2, "два имени — один персонаж, одна озвучка");
    assert.ok(!state.characters.some((item) => item.name === "MALE VOICE"));
    assert.deepEqual(
      state.speakers.filter((item) => s01.some((line) => line.speaker === item.name)).map((item) => [item.name, item.character, item.source, item.assigned]),
      [
        ["BABUSHKA", "ba", "episode", "ba"],
        ["MALE VOICE", "militsiya_officer_young", "episode", "militsiya_officer_young"],
        ["MILITSIONER", "militsiya_officer_young", "episode", "militsiya_officer_young"],
      ],
    );
    assert.throws(() => assignSpeaker(EP, "BABUSHKA", "nobody"), /Нет персонажа «nobody»/);

    // «Запомнить»: псевдоним в voice.json персонажа — без назначения эпизода имя находится само.
    writeVoiceConfig("ba", { voice_id: "voiceBaba001" });
    assignSpeaker(EP, "BABUSHKA", "ba", true);
    assignSpeaker(EP, "BABUSHKA", null);
    ({ lines } = await readPostLines(EP));
    assert.equal(lines.find((line) => line.speaker === "BABUSHKA")!.character, "ba");
    assert.equal(speakerResolver(EP)("Babushka").source, "alias");
    // Форма голоса не теряет псевдонимы.
    writeVoiceConfig("ba", { voice_id: "voiceBaba002" });
    const voice = JSON.parse(fs.readFileSync(path.join(getCharactersRoot(), "ba", "voice.json"), "utf8"));
    assert.deepEqual([voice.voice_id, voice.aliases], ["voiceBaba002", ["BABUSHKA"]]);
  } finally {
    fs.rmSync(speechFile, { force: true });
    fs.rmSync(path.join(postDir(EP), "speakers.json"), { force: true });
  }
});

/** Проверка парности тегов XML (парсера XML в Node нет). */
function assertWellFormed(xml: string) {
  const body = xml.replace(/<\?xml[^>]*\?>/, "").replace(/<!DOCTYPE[^>]*>/, "");
  const stack: string[] = [];
  for (const match of body.matchAll(/<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing) continue;
    if (closing) assert.equal(stack.pop(), name, `закрывающий </${name}>`);
    else stack.push(name);
  }
  assert.deepEqual(stack, []);
  assert.equal(body.replace(/<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g, "").includes("<"), false, "лишние <");
}
