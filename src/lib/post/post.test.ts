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

import { createEpisode, getCharactersRoot, shotDir, stageDir } from "../series/paths";
import { lineSeparator } from "./align";
import { collectPost } from "./collect";
import { synthesizeMedia } from "./ffmpeg";
import { readPostLines, updatePostLine } from "./lines";
import { linesFile, manifestFile, timelineDir, voicesDir } from "./paths";
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

  // Повторная сборка — новая версия, старая остаётся.
  await buildTimeline(EP, { width: 1080, height: 1920 });
  assert.deepEqual(fs.readdirSync(timelineDir(EP)).sort(), ["e01_v1.fcpxml", "e01_v2.fcpxml"]);
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
