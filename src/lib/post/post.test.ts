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
delete process.env.SERIES_ROOT;

import { readComfyJob } from "../comfy/queue";
import { createEpisode, getCharactersRoot, getComfyQueueRoot, shotDir, stageDir } from "../series/paths";
import { lineSeparator } from "./align";
import { collectPost } from "./collect";
import { synthesizeMedia } from "./ffmpeg";
import { readPostLines, updatePostLine } from "./lines";
import { linesFile, manifestFile, timelineDir, voicesDir } from "./paths";
import { buildProject } from "./build";
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
const seen: Seen[] = [];
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
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
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
  assert.deepEqual(done.results, [{ character: "Julia", version: 1 }]);

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

  const voice = readCurrentVoice(EP, "Julia")!;
  assert.equal(voice.file, "v1.wav");
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
