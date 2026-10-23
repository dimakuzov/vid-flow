// Субтитры и музыка: пословные титры, ASS со стилем шаблона, вставка в проект как у Kdenlive, громкость музыки.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MUSIC_DUCK_DB, MUSIC_GAIN_DB, musicLevelKeyframes } from "./music";
import { assDocument, buildWordCues, patchProjectSubtitles } from "./subtitles";
import { ensureMusicTrack } from "./music-insert";
import { parseMltTime, projectVoiceLines } from "./project-read";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const w = (value: string, start: number, end: number) => ({ value, start, end });

test("пословные титры: текст из реплик, время от Whisper, паузы внутри фразы заполнены", () => {
  const { cues, missing } = buildWordCues(
    ["...like to imagine things.", "Oh my God... I've lost my diary!"],
    [
      w("Like", 1.0, 1.2),
      w("to", 1.2, 1.3),
      w("imagine", 1.3, 1.7),
      w("things.", 1.7, 2.0),
      w("Oh", 4.0, 4.2),
      w("my", 4.2, 4.3),
      w("god.", 4.3, 4.6),
      w("lost", 5.0, 5.3),
      w("my", 5.3, 5.4),
      w("diary.", 5.4, 5.9),
    ],
  );
  assert.deepEqual(
    cues.map((cue) => cue.text),
    ["like", "to", "imagine", "things.", "Oh", "my", "God...", "I've", "lost", "my", "diary!"],
    "текст и пунктуация — из реплик, без «...» в начале",
  );
  assert.deepEqual(missing, ["I've"]);
  const ive = cues[7];
  assert.ok(ive.start >= 4.6 && ive.end <= 5.0, `не услышанное слово — между соседями: ${ive.start}–${ive.end}`);
  assert.equal(cues[0].end, 1.2, "следующее слово сразу — держится до него");
  assert.equal(cues[3].end, 2.0, "до долгой паузы — до конца слова");
  assert.ok(cues.every((cue, index) => index === 0 || cue.start >= cues[index - 1].end - 1e-9), "титры не перекрываются");
});

test("ASS: шапка и стиль — из шаблона Kdenlive, события — свои", () => {
  const template = `\uFEFF[Script Info]\r\nPlayResX: 720\r\nPlayResY: 1280\r\n\r\n[Kdenlive Extradata]\r\nDefaultStyles: Yellow\r\n\r\n[V4+ Styles]\r\nFormat: Name, Fontname, Fontsize\r\nStyle: Yellow,Impact,120\r\n\r\n[Events]\r\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\r\nDialogue: 0,0:00:01.00,0:00:02.00,Yellow,,0,0,0,,old\r\n`;
  const ass = assDocument(template, [{ start: 5.58, end: 6, text: "Now" }, { start: 3661.5, end: 3662, text: "late" }], { width: 720, height: 1280 });
  assert.ok(ass.startsWith("[Script Info]"));
  assert.match(ass, /\[Kdenlive Extradata\]/);
  assert.match(ass, /^Style: Yellow,Impact,120$/m);
  assert.ok(!ass.includes(",old"), "старые события шаблона не переносятся");
  assert.match(ass, /^Dialogue: 0,0:00:05\.58,0:00:06\.00,Yellow,,0,0,0,,Now$/m);
  assert.match(ass, /^Dialogue: 0,1:01:01\.50,1:01:02\.00,Yellow,,0,0,0,,late$/m);
  assert.match(assDocument(null, [], { width: 720, height: 1280 }), /^Style: Default,Arial/m, "без шаблона — простой стиль");
});

const project = `<?xml version='1.0' encoding='utf-8'?>
<mlt LC_NUMERIC="C" producer="main_bin" version="7.41.0" root="">
<tractor id="{seq}" in="0" out="99">
  <property name="kdenlive:uuid">{seq}</property>
  <property name="kdenlive:sequenceproperties.hidesubtitle">1</property>
  <track producer="black_track"/>
  <filter id="sequence_volume">
   <property name="mlt_service">volume</property>
  </filter>
</tractor>
<playlist id="main_bin">
  <property name="kdenlive:docproperties.activetimeline">{seq}</property>
</playlist>
<tractor id="tractor_project" in="0" out="99">
  <track producer="{seq}"/>
</tractor>
</mlt>
`;

test("вставка субтитров в проект — как пишет сам Kdenlive; повторно — замена, а не второй фильтр", () => {
  const file = "C:\\Users\\me\\data\\episodes\\e01\\post\\timeline\\e01_v2.kdenlive.ass";
  const once = patchProjectSubtitles(project, file);
  const sequence = once.slice(once.indexOf('<tractor id="{seq}"'), once.indexOf("</tractor>"));
  assert.match(sequence, /<property name="kdenlive:sequenceproperties\.subtitlesList">\[[\s\S]*&quot;file&quot;: &quot;C:\/Users\/me\/data\/episodes\/e01\/post\/timeline\/e01_v2\.kdenlive\.ass&quot;/);
  assert.match(sequence, /<property name="kdenlive:sequenceproperties\.hidesubtitle">0<\/property>/);
  assert.match(sequence, /<property name="mlt_service">avfilter\.subtitles<\/property>[\s\S]*<property name="av\.filename">C:\/Users\/me\/data\/episodes\/e01\/post\/timeline\/e01_v2\.kdenlive\.ass<\/property>/);
  assert.match(sequence, /sequence_volume/, "остальные фильтры на месте");
  assert.ok(!once.slice(once.indexOf("tractor_project")).includes("avfilter.subtitles"), "только в последовательности");

  const twice = patchProjectSubtitles(once, file.replace("v2", "v3"));
  assert.equal(twice.match(/avfilter\.subtitles/g)!.length, 1);
  assert.equal(twice.match(/sequenceproperties\.subtitlesList/g)!.length, 1);
  assert.match(twice, /e01_v3\.kdenlive\.ass<\/property>/);
  assert.throws(() => patchProjectSubtitles("<mlt></mlt>", file), /активной последовательности/);
});

test("музыка: появление, тише под репликами, затухание к концу", () => {
  const fps = 24;
  const keys = new Map(musicLevelKeyframes(480, [{ start: 96, end: 144 }, { start: 160, end: 200 }, { start: 300, end: 330 }], fps));
  const frames = [...keys.keys()];
  assert.equal(keys.get(0), -60);
  assert.equal(keys.get(24), MUSIC_GAIN_DB, "через секунду — обычная громкость");
  assert.equal(keys.get(96), MUSIC_DUCK_DB);
  assert.equal(keys.get(200), MUSIC_DUCK_DB, "пауза меньше секунды между репликами — музыка не поднимается");
  assert.ok(!keys.has(144) || keys.get(144) === MUSIC_DUCK_DB);
  assert.equal(keys.get(300), MUSIC_DUCK_DB);
  assert.equal(keys.get(337), MUSIC_GAIN_DB, "после реплики — обратно");
  assert.equal(keys.get(431), MUSIC_GAIN_DB, "затухание начинается за 2 с до конца");
  assert.equal(keys.get(479), -60);
  assert.deepEqual(frames, [...frames].sort((a, b) => a - b));
  assert.ok(frames.every((frame) => frame >= 0 && frame <= 479));
});

test("вырезанные в проекте края фраз в субтитры не идут; одиночный пропуск внутри — между соседями", () => {
  const { cues, missing, cut } = buildWordCues(
    ["...like to imagine things. I like fantasy fiction.", "Nobody said this at all.", "Really? Why?"],
    [w("I", 2.0, 2.1), w("like", 2.1, 2.3), w("fantasy", 2.3, 2.7), w("fiction.", 2.7, 3.1), w("Why?", 5.0, 5.3)],
  );
  assert.deepEqual(cues.map((cue) => cue.text), ["I", "like", "fantasy", "fiction.", "Really?", "Why?"]);
  assert.deepEqual(cut, ["like", "to", "imagine", "things.", "Nobody", "said", "this", "at", "all."]);
  assert.deepEqual(missing, ["Really?"], "одно слово на краю — не вырезано, а не расслышано");
});

test("реплики из проекта, сохранённого Kdenlive: атрибуты in/out/producer, время ЧЧ:ММ:СС, ускоренный клип", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-project-read-"));
  const voices = path.join(dir, "voices", "Lena");
  fs.mkdirSync(voices, { recursive: true });
  fs.writeFileSync(path.join(voices, "v2.json"), JSON.stringify({
    lines: [
      { id: "s05-2", text: "But why?", speechStart: 1.0, speechEnd: 1.8 },
      { id: "s05-4", text: "I am Lena.", speechStart: 4.0, speechEnd: 5.0 },
      { id: "s07-2", text: "Did he throw you out too?", speechStart: 8.0, speechEnd: 9.5 },
    ],
  }));
  const file = path.join(voices, "v2.wav").split(path.sep).join("/");
  const xml = `<mlt LC_NUMERIC="en_US.UTF-8" producer="main_bin" root="${dir.split(path.sep).join("/")}">
 <chain id="chain3" out="00:00:20.000"><property name="resource">${file}</property><property name="mlt_service">avformat-novalidate</property></chain>
 <producer id="producer9" in="00:00:00.000" out="00:00:10.000"><property name="resource">2:${file}</property><property name="warp_speed">2</property><property name="warp_resource">${file}</property><property name="mlt_service">timewarp</property></producer>
 <playlist id="playlist0"/>
 <playlist id="playlist4">
  <property name="kdenlive:audio_track">1</property>
  <blank length="00:00:10.000"/>
  <entry in="00:00:00.750" out="00:00:01.958" producer="chain3"><property name="kdenlive:id">17</property></entry>
  <blank length="00:00:01.000"/>
  <entry in="00:00:03.875" out="00:00:04.958" producer="producer9"><property name="kdenlive:id">17</property></entry>
 </playlist>
 <playlist id="main_bin"><entry producer="chain3" in="0" out="479"/></playlist>
</mlt>`;
  assert.equal(parseMltTime("00:00:01.000", 24), 24);
  assert.equal(parseMltTime("48", 24), 48);
  const lines = projectVoiceLines(xml, 24);
  // s05-2: клип 0.75–2.0 с файла с 10 с; s05-4 вырезана; s07-2: x2, кадры 93–119 → файл 7.75–10.0 с.
  assert.deepEqual(lines.map((line) => line.id), ["s05-2", "s07-2"]);
  assert.equal(lines[0].time, 10.25, "речь — через 0.25 с после начала клипа");
  const s07Start = 10 + 1.25 + 1; // начало второго клипа на таймлайне
  assert.ok(Math.abs(lines[1].time - (s07Start + (8 - 7.75) / 2)) < 0.01, `ускоренный клип: ${lines[1].time}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("дорожка «Музыка» в старом проекте: внизу, номера дорожек в переходах, группах и целях сдвинуты", () => {
  const xml = `<mlt producer="main_bin">
 <tractor id="tractor6" in="00:00:00.000" out="00:01:08.750">
  <property name="kdenlive:uuid">{seq}</property>
  <property name="kdenlive:sequenceproperties.audioTarget">0</property>
  <property name="kdenlive:sequenceproperties.videoTarget">1</property>
  <property name="kdenlive:sequenceproperties.activeTrack">1</property>
  <property name="kdenlive:sequenceproperties.tracksCount">2</property>
  <property name="kdenlive:sequenceproperties.tracks">2</property>
  <property name="kdenlive:sequenceproperties.groups">[{"children":[{"data":"1:0","leaf":"clip"},{"data":"0:0","leaf":"clip"},{"data":"-2:5:0","leaf":"subtitle"}],"type":"AVSplit"}]</property>
  <track producer="producer0"/>
  <track producer="tractor0"/>
  <track producer="tractor1"/>
  <transition id="transition0"><property name="a_track">0</property><property name="b_track">1</property><property name="mlt_service">mix</property></transition>
  <transition id="transition1"><property name="a_track">0</property><property name="b_track">2</property><property name="mlt_service">qtblend</property></transition>
 </tractor>
 <playlist id="main_bin"><property name="kdenlive:docproperties.activetimeline">{seq}</property></playlist>
</mlt>`;
  const out = ensureMusicTrack(xml, 100);
  const seq = out.slice(out.indexOf('<tractor id="tractor6"'), out.indexOf("</tractor>", out.indexOf('<tractor id="tractor6"')));
  assert.match(seq, /<track producer="producer0"\/>\s*<track producer="frameboard_music_tractor"\/>\s*<track producer="tractor0"\/>/);
  assert.match(seq, /id="transition0"><property name="a_track">0<\/property><property name="b_track">2</);
  assert.match(seq, /id="transition1"><property name="a_track">0<\/property><property name="b_track">3</);
  assert.match(seq, /<transition id="frameboard_music_mix">[\s\S]*"b_track">1</);
  assert.match(seq, /audioTarget">1</);
  assert.match(seq, /videoTarget">2</);
  assert.match(seq, /activeTrack">2</);
  assert.match(seq, /tracksCount">3</);
  assert.match(seq, /"data":"2:0"[\s\S]*"data":"1:0"[\s\S]*"data":"-2:5:0"/, "группы сдвинуты, субтитры — нет");
  assert.ok(out.indexOf('<tractor id="frameboard_music_tractor"') < out.indexOf('<tractor id="tractor6"'), "дорожка определена до последовательности");
  assert.match(out, /"kdenlive:track_name">Музыка</);
  assert.equal(ensureMusicTrack(out, 100), out, "второй раз — без изменений");
});
