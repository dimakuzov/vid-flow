# Contract: the episode post stage (voices, timeline, Kdenlive project)

Code: `src/lib/post/`. The "Post" section under the shot table: `src/components/board/post-panel.tsx`.

## Folders and files

```text
data/characters/{Name}/voice.json        a character's voice, shared by all episodes
data/episodes/{ep}/post/
  lines.json                             edits of the lines made on the board
  voices/{Character}/v{N}.wav            a character's voice-over: all their lines in one file (cleaned by Voice Isolator)
  voices/{Character}/v{N}.raw.wav        the same join before cleaning
  voices/{Character}/v{N}.isolated.mp3   the Voice Isolator answer as it is
  voices/{Character}/v{N}.json           the version: line boundaries, chunks, settings
  voices/{Character}/v{N}.part{K}.mp3    the ElevenLabs answer as it is (+ .json: request-id, text, timestamps)
  voices/{Character}/current.json        { version, updatedAt }, the version in use
  manifest.json                          the manifest of the latest timeline build
  timeline/{ep}_v{N}.fcpxml              timelines, old ones are not overwritten (next to it the .kdenlive of the same build)
  music/*.mp3|wav|flac|m4a|ogg|aac       the episode's music (put there by the user)
  subtitles/                             Whisper over the project's sound, `{project}.whisper.mp4`
  render/{ep}_vN_rK.mp4                  renders of the project with subtitles
  speech/{shotId}.json                   speech recognition of the final: which final, which queue job
  speech/{shotId}/{jobId}/*.txt          Whisper outputs (words and phrases, JSON)
  jobs/voice-*.json                      voice-over jobs
```

| File | Written by | Agent |
|---|---|---|
| `voice.json` | the user or the "Voice" form on the board (`PUT .../post/voices`) | does not invent a `voice_id` |
| `lines.json` | the board: a line edit, voice-over, timeline build | no |
| `voices/**` | the voice-over job; `current.json` is also the version choice on the board | no |
| `manifest.json`, `timeline/**` | "Build timeline" | read |
| `jobs/**` | the board | no |

The board deletes nothing in `post/`.

## Lines

The text and the character come **only from `shots/{shotId}/speech.md`** of the active shots: shots hidden from the table (`hidden_shots.json`) do not go into post: no lines, no speech recognition, no shot and no gap on the timeline (`activeShotIds`). One line per row, `Name: text`; a row without a name is the line of the shot's only character from `shot.md`. A name from the script (`speaker`) is mapped to a library character (`character`: whose voice, voice file and track), see `src/lib/post/speakers.ts`:

1. the episode assignment `post/speakers.json` → `{ "map": { "GRANDMA": "ba", "MALE VOICE": "militsiya_officer_young" } }` (the block "Who voices the script names", `PUT .../post/speakers { speaker, character | null, remember? }`);
2. an alias for all episodes: `data/characters/{Name}/voice.json` → `"aliases": ["GRANDMA"]` (the "remember" checkbox; the voice form keeps the aliases);
3. otherwise the library folder with the same name, case-insensitive (`julia` → `Julia`), otherwise the name as is.

Two names for one character mean one voice-over and one track. speech.md, the line text and the subtitles do not change. After a reassignment the lines move to the other character's voice-over, which has to be recorded again. The order is the order of the table's shots.

`lines.json` → `{ updatedAt, lines: [{ id, shotId, character, text, order, at, atManual, trimIn, trimOut, speed }] }`:

- `id` is `{shotId}-{row number}`: `s05-2`.
- `at` is the seconds from the start of the shot where the speech begins. `atManual: false` means the board computes the place itself at every read: if the shot's final has its own sound (H3), the lines are placed on its sounding stretches (`silencedetect`, the borders between lines are the longest pauses); otherwise one after another: the first at 0.3 s, the next 0.4 s after the end of the previous (the duration is from the voice-over, without it about 15 characters per second).
- `trimIn`, `trimOut` shift the borders of a segment relative to the auto borders, in seconds (minus means earlier).
- If a line's text in speech.md changed, `trimIn/trimOut` are reset, `at` stays, and the line's voice-over counts as outdated.

Reading (`GET .../post`) writes nothing.

## Voice and voice-over

`voice.json` → `{ "voice_id", "model_id", "text_prefix", "voice_settings": { stability, similarity_boost, style, speed, use_speaker_boost }, "seed" }`. `model_id` is `eleven_v3` by default (the project's model).

`text_prefix` is an audio tag that the board prepends to **every** phrase of the character on **every** send: `[strong Russian accent] Who is that guy?`. If the field is absent it is `[strong Russian accent]`; an empty string means no tag. The tag does not get into `speech.md`, `lines.json`, the manifest or the subtitles; the line is searched in the timestamps without it, so the start of the speech is the first word. The v2 models do not understand tags and would read them aloud.

A character's voice-over is one new version `v{N}`:

1. All the character's lines in order, each with `text_prefix`, joined by `\n<break time="1.0s" />\n` (for `eleven_v3` an empty line: it does not understand `<break>`).
2. Chunks no longer than `POST_TTS_CHUNK_CHARS` (2500 by default) characters; a line is not cut. Each chunk is `POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128`; the next one gets `previous_request_ids` (up to the last 3 `request-id`s); `eleven_v3` has no request stitching, so `previous_text` is used.
3. The chunks become `v{N}.wav` (44.1 kHz, mono), with 1 s of silence between chunks.
4. A line is searched in the answer by text in `alignment.characters`. The edge of the sound is refined by silence (`silencedetect`, −35 dB, 0.2 s): the end is the start of the silence after the line (fade, breath), the start is the end of the silence before it. The segment is the sound + 0.12 s before and 0.2 s after, but not beyond the middle of the pause to the neighboring line.
5. `v{N}.json` → `{ version, character, createdAt, file, duration, config, chars, chunks: [{ file, requestId, text, lineIds, offset, duration }], lines: [{ id, text, speechStart, speechEnd, in, out }] }`; `current.json` switches to the new version.

An error in the middle leaves the paid chunks on disk, and the version does not become current. A version number is not reused.

### Voice cleaning (Voice Isolator)

`voice.json` → `"isolate"` (absent means `true`). After the join `v{N}.raw.wav` goes to `POST /v1/audio-isolation` (multipart, field `audio`; the answer is mp3, about 1000 credits per minute of sound). The answer is saved as `v{N}.isolated.mp3` and decoded into `v{N}.wav` of exactly the same length as the source (the line borders do not move); silence and borders are computed on the cleaned file.

- `v{N}.json` → `rawFile` (the source) and `isolation: { status: "done" | "error" | "off", credits?, error?, at? }`; `file` is what goes into the project.
- If cleaning fails, the voice-over is already paid for: the version becomes current with `file` = the source, `isolation.status: "error"`, the error in the job (`results[].isolationError`). There is no resend.
- "Clean the voice" (`POST .../post/voice-job` with `kind: "isolate"`, the same checkbox) cleans the current voice-over without a new generation: the same version gets `v{N}.clean.wav`, `file` switches to it, `rawFile` is the earlier file. It does not queue an already cleaned one again.
- The cost estimate in the job and on the board: `chars` (voice-over characters) and `isolationChars` (≈ cleaning credits).

Regenerating a character does not lose the edits: `at`, `trimIn`, `trimOut` are kept in `lines.json` by the line `id` and applied to the new version while the line's text is unchanged. Edits made in a video editor are not seen by the board (no scripts): the agreement is rough work on the board, final work in the editor, and after that the timeline is not rebuilt.

## Paid sending

A voice-over job is queued only by `POST .../post/voice-job` with `allowPaid: true`: the checkbox "Allow paid sending to ElevenLabs" for one run, with a cost estimate in characters next to it. Without it there is an error and nothing goes to ElevenLabs. The key is `ELEVENLABS_API_KEY` in `.env.local` (written by the user). `ELEVENLABS_URL` is another address (tests).

`jobs/voice-*.json` → `{ id, episodeId, characters, kind: voice|isolate, status: pending|running|done|error, chars, isolationChars, allowPaid, createdAt, startedAt, finishedAt, pid, progress, results: [{ character, version, isolation?, isolationError? }], error }`. It runs in the board process right after queuing, one job per episode at a time. There is no resend: a job that no process is running (the board was restarted) is shown and written as `error` "The voice-over was interrupted…".

## Speech in the shots: lip sync

Finals made by H3 have their own speech with lip sync. "Build project" (`POST .../post/timeline`) first queues recognition for the shots that have none, where it failed, or where the final was replaced, waits for it (a job that did not reach ComfyUI within 90 s is not waited for: the shot is built without fitting, with a note in `warnings`) and then builds. `POST .../post/speech` queues into the board queue (`data/comfy_queue`, the local ComfyUI, free) the graph `playbooks/workflows/comfy/create_subtitles_file_from_video.json` (ComfyUI-Whisper, the JSON is not edited): the video from `final_render/approve/` goes into `VHS_LoadVideo`, and the job has `saveText: true`. The Whisper words (`PreviewAny` from `words_alignment`) are `{ value, start, end }`.

- The recognition is tied to the final file (name, size, time): if the final is replaced, the status is `stale` and there are no frames until a new run ("again").
- The words are matched to the shot's lines by text (order-preserving alignment, extra Whisper words do not hurt). If fewer than 40 % of a line's words are found, there is no frame.
- The lip frame of a line `[start, end]` (seconds from the shot start): the auto place `at` = `start`; the clip speed = the length of the voice-over speech / the frame length, within 0.8–1.35× (outside that, a warning "N× needed").
- A manual speed is `lines.json` → `speed` (a number; `null` is auto), edited on the board.
- Speed exists only in the Kdenlive project: an MLT `timewarp` producer with `warp_pitch=1` (the pitch does not change, like "Change speed" with pitch compensation). In FCPXML the clips have no speed-up (a warning in the manifest).

## The Kdenlive project

"Build project" writes next to the FCPXML the `timeline/{ep}_v{N}.kdenlive` of the same build (`src/lib/post/kdenlive.ts`, document format 1.1, Kdenlive 23.04+, checked on 26.08 through `melt`). In Kdenlive: File → Open. The profile is the build's frame size, 24 fps. Tracks:

- "Shots" (V1): the finals one after another, without their own sound; a shot without a final is a gap;
- one track per character (A1… in order of the first line): the lines are segments of the long wav, with the same in/out and place as in the manifest; every line has the Kdenlive effects "Fade in" / "Fade out" of 2 frames each (`VOICE_FADE_FRAMES`) so that the cut does not click;
- "Final sound (off)" (the lowest A): the H3 sound, the track is switched off (`hide="both"`).

Lines of one character cannot overlap on one track: the end of the previous one is trimmed at the start of the next (`warnings` has "overlaps"). File paths are absolute: open the project from `post/timeline/` and do not move the voice and shot files.

## Music

A project build always leaves an empty lower track "Music" (`MUSIC_TRACK_NAME`) so that the track numbers do not shift later in an edited project (Kdenlive keeps groups and transitions by them).

"Add subtitles" (step 5 below) puts the files from `post/music/` into it (by name, in a loop up to the end of the project, the last one trimmed) and the Kdenlive effect "Volume" (`kdenlive_id: volume`, keyframes `level`, dB): silence → 1 s before it −6 dB, where Whisper heard speech in this project (words closer than 0.6 s count as one speech), −22 dB (a 0.3 s transition, pauses shorter than 1 s do not raise it), and 2 s before the end into silence. The constants are in `src/lib/post/music.ts`, the insertion is in `src/lib/post/music-insert.ts`. Its own clips are `frameboard_music*` (in the bin "Music: file"); on a repeat they and any Volume effect on this track are replaced (Kdenlive renames ids when saving). If there is no "Music" track (the project was built before this), it is created at the bottom above the black one: track numbers shift by 1 in the sequence transitions (`a_track`/`b_track`, MLT numbers) and in Kdenlive's groups and targets (`groups`, `audioTarget`, `videoTarget`, `activeTrack`, without the black one, from 0), `tracksCount` + 1. FCPXML has no music.

## Subtitles and render

"Add subtitles" (`POST .../post/subtitles`, free) works on the latest project `post/timeline/{ep}_vN.kdenlive`, which the user edits:

1. The project's sound is made with `melt` (from Kdenlive; the path is `MELT` or a search for `kdenlive*/bin/melt.exe` in `C:/Programs`, `Program Files`, Downloads), 16 kHz mono; with it a 64×64 video at 1 frame/s (`subtitles/{project}.whisper.mp4`) for the graph's loader.
2. Whisper: `create_subtitles_file_from_video.json` through the queue (`saveText`).
3. Word-by-word titles. The lines are those that really lie in the project (`src/lib/post/project-read.ts`): the voice clips on the tracks (attributes in any order, time in frames or `HH:MM:SS.mmm`, `timewarp` with its speed), and from the `vN.json` next to the file, which lines a segment plays (≥ 50 % of the line's speech); the order is by place on the timeline. If none is found, the manifest's lines are used (`linesFrom`). The words of the lines (with punctuation, without a leading "...") are aligned with the Whisper words; the time is Whisper's, a word holds ≥ 0.25 s, pauses < 0.6 s are filled. A clip that plays a piece of a line (it was cut in Kdenlive) gives only its own words: the word times are from the ElevenLabs timestamps (`vN.partK.json` + the chunk `offset`; otherwise by the share of characters), and a word belongs to a clip segment by its middle; a line cut into clips goes in pieces to their places. A line word from the project is matched only to a Whisper word within 2 s of its place; an unheard one goes to its own time in the project. Lines without word times (from the build): unheard words inside a phrase go between neighbors (`missing`), two or more in a row at the edge or a whole line are cut out (`cut`). Speech outside the lines (a shot inserted in Kdenlive with its own sound): Whisper words that did not fall on the lines and are not between words of one line go into the titles as its own text (`extra`) if they are farther than 0.5 s from the lines or come three or more in a row (Whisper can put someone else's phrase at the same point as a line), in its order, not earlier than the previous + 0.25 s; a piece that does not fit before the next heard word of a line (or the end of the sound) is squeezed before it, so it does not mix with the line.
4. `{project}.kdenlive.ass`: the header and styles come from `data/subtitles/style.ass` (everything before `[Events]`), the events are its own: for each word two events at one point (`\an` + `\pos` from the alignment and the text style's margins), layer 0 with the style "Box" (a plate with BorderStyle 3, transparent text, `\blur16`, shifted by the plate margin), layer 1 the sharp text. If there is no "Box" in the template, it is made from the text style: a 55 % darkening (`&H73000000`), a 10 px margin. `MaxLayer: 1` so Kdenlive shows both layers. The old `.ass` and the project are copied (`*.before-subs-{time}.*`).
5. Music goes into the "Music" track (the section above).
6. Into the project, as Kdenlive 26.08 writes it: in the sequence (`kdenlive:docproperties.activetimeline`; on saving Kdenlive calls it `tractorN`, the uuid is the property `kdenlive:uuid`) the property `kdenlive:sequenceproperties.subtitlesList` (`[{ file, id: 0, name }]`), `hidesubtitle = 0` and the filter `avfilter.subtitles` with `av.filename` (an absolute path). A repeat run replaces and does not add. Before writing there is a check (`src/lib/post/audible.ts`): everything that sounded in the project after the user's edits (clips on enabled audio tracks mixed by a `mix` transition, any track, with the board's lines or without, except its own music `frameboard_*`) sounds after the board's edit too, the same file, segment and place; otherwise the project is not written and the job is an error with a list of clips.
7. A `melt` render: H.264 1.6 Mbit/s, yuv420p, AAC 192 kbit/s 48 kHz, the project's size and fps → `render/{project}_rK.mp4`.

The job `post/jobs/subs-*.json`: `{ id, kind: subtitles, episodeId, project, status, progress, ass, backup, render, words, lines, linesFrom, missing, cut, music, musicNote, error }`. The project in Kdenlive must be saved and closed before the run.

## Render in Kdenlive with the board's settings

`src/lib/post/render-preset.ts`. The preset "Frameboard MP4 H264 1600k" (category Custom) is in Kdenlive's user presets `%LOCALAPPDATA%/kdenlive/export/customprofiles.xml` (RenderPresetRepository reads them there; other presets of the file are not touched; `KDENLIVE_DATA` is another folder, for tests): H.264 `vb=%bitrate+'k'` (1600 by default), yuv420p, g=48, AAC `%audiobitrate` (192) 48 kHz stereo, speed medium. In the project: the preset choice and the output path (`kdenlive:docproperties.rendercategory/renderprofile/renderurl…` in the bin), the output is `post/render/{project}_kdenlive.mp4`. It is written on "Build project", "Add subtitles" and "Open in Kdenlive". Kdenlive reads the presets at start.

## Timeline (FCPXML 1.9)

In Resolve: File → Import → Timeline. The sequence is 24 fps, the frame size is chosen on the board (720×1280 by default).

- The strip: the shots' finals (`final_render/approve/`, the first video) one after another, video only (`srcEnable="video"`). A shot without a final is a `<gap>` of at least 3 s.
- Track −1: the finals' own sound (H3), clips `enabled="0"`, for checking the lips.
- Then a track per character (−2, −3… in order of the first line). A line is a segment of `v{N}.wav` (`start` = the in point in the source) placed so that the start of the sound falls on `shot start + at`. All the segments of a character are one asset.
- Lines without an up-to-date voice-over do not go into the timeline (`manifest.skipped`).
- Times are rounded to the frame 1/24.

`manifest.json` → `{ episodeId, builtAt, fps, width, height, timeline, duration, characters: [{ name, lane }], shots: [{ shotId, file, start, duration, hasAudio }], lines: [{ id, shotId, character, text, source, sourceIn, sourceOut, at, timelineStart, timelineEnd, lane }], skipped: [{ id, reason }], warnings }`.

## API

| Method and path | What it does |
|---|---|
| `GET /api/episodes/{ep}/post` | `PostState`: the lines with segments, voices, finals, timelines, the latest job |
| `PATCH .../post/lines` `{ id, at?, trimIn?, trimOut?, speed? }` | a line edit (`at: null`, `speed: null` returns to auto) → `PostState` |
| `PUT .../post/voices` `{ character, voice_id, model_id?, voice_settings?, seed? }` | `voice.json` → `PostState` |
| `POST .../post/voices` `{ character, version }` | make a voice-over version current → `PostState` |
| `POST .../post/voice-job` `{ characters, allowPaid: true, kind? }` | voice-over (`voice`, with cleaning if on) or cleaning of the current voice-over (`isolate`), paid → `VoiceJob` |
| `POST .../post/speech` `{ shotIds?, force? }` | recognize the finals' speech (Whisper, the ComfyUI queue) → `{ queued, skipped }` |
| `POST .../post/subtitles` | subtitles on the latest project and a render → `SubtitlesJob` |
| `POST .../post/timeline` `{ width?, height? }` | a new version: `.kdenlive` and `.fcpxml` → `Manifest` (`kdenlive`, `timeline`) |
| `GET .../post/file?path=` | a file of the post folder (`.wav .mp3 .json .fcpxml .kdenlive .srt`), Range for sound; timelines are for download |
