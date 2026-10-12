# MiniMax H3 final render: how to write the text and how not to

English copy for the agent. Russian original: `playbooks/models/minimax_h3.md`.

Built from the final renders of the “Vera” clip (S1–S28). This is only about the **text** the model reads: what worked, what spoiled the result, what was useless. The board format of `prompt.md` is section 8.

---

## 1. The main points

1. **Text does not fix bad inputs.** If the first frame and the low-res video disagree (sleeves in S6, water leaking in S4), the model follows the video and mixes both versions. Fix the source first, then write the text.
2. **The base is the refined Wan prompt plus one fixed phrase.** Do not write your own prompt from scratch: the refiner builds the Context-IR form (subjects, sections, `@img-N` labels) better.
3. **Shorter is better.** Every successful fix replaced or removed a phrase; none added a paragraph. A long prompt was never better than a short one.
4. **The model reacts to words, not to negations.** “no sparkles” = “sparkles”. Describe what must be there.
5. **Check every refine by eye.** In about every second shot with people the refiner broke something: image numbers, an extra character, “close-up”, “looks around”.

---

## 2. What the text is made of

```
[fixed phrase]
[refiner body — fix it pointwise]
+ sections: subject_definitions / summary / retention_analysis
+ overall_soundscape
```

**The fixed phrase** always comes first (after `[Shot 1]` if present):
> The scene begins from @img-1, the same camera position, the same frame, The first frame must exactly replicate @img-1. use @vid-1 as a reference, use the movements and the lighting changes from it.

Exception: if the low-res video has flicker or noise that the final must not have (S4) — “use @vid-1 as a reference for the movements only”.

**The closing line** ends the body. H3 kept recomposing the shot, moving the camera and rebuilding the frame, and drew faces poorly; the line makes the first frame and the preview hard requirements, gives H3 freedom on quality, and asks for new lip movement:
> @img-1 is the required first frame: the video opens exactly on it. @vid-1 is the required motion guide: every person and every object moves exactly as in @vid-1, with the same timing, the same positions and the same camera. This is a quality pass over @vid-1: re-render it in much higher detail and realism, with sharp, clean faces, eyes, skin, hair, fabric, light and textures, free of the blur, noise and artifacts of @vid-1. Where someone speaks, re-animate the mouth and face so the lips pronounce every word of the dialogue with precise lip sync. Do not add, remove or move people or objects, and do not change the composition.

The board guarantees both: if the body lacks `use @vid-1 as a reference`, it puts the fixed phrase first; if it lacks `required motion guide`, it adds the closing line at the end (manifest `steps`). Write them yourself when you need a variant (S4), and the board will not add a second copy.

To see what H3 really got, read the metadata of the output video file itself, or `data/comfy_queue/<id>.json`. Do not open the video in the ComfyUI interface to check it: the Continuity node's frontend overwrites `creator_data` with its own empty state (empty prompt, no assets, 16:9), and the saved workflow shows that instead.

**The source to refine** is the prompt of the approved sketch, as saved in the video metadata (`video_preview/approve/`, the `prompt` key). No metadata — the sketch's `prompt.md`, and the board notes that in `run_log.md`. Not the prompt of an older H3 render: its action may differ (S6: in the old text the water turned red, in the approved video it washes away). An edit of `prompt.md` after the video was approved does not reach the final until the video is generated again.

---

## 3. What went wrong and what fixed it

| Shot | What happened | Where it came from | What fixed it |
|---|---|---|---|
| **S7** | a face close-up instead of the whole frame | the refiner wrote “medium close-up”, “focusing on her facial movements”, and “toiletries simplified” in retention | those words removed + **listing what is where in the frame** (mirror, tiles, shelf with objects, curtain) and that everything stays in place to the end |
| **S7** | blood runs although it is already on the first frame | “blood slowly trickles” in the Wan prompt | “the streak of blood already in @img-1 stays exactly as it is” |
| **S14** | looks aside, “runs from someone” | “looking around confused” in the Wan prompt | “looks straight ahead in the direction she is running… her gaze stays fixed forward” |
| **S13** | grabs the railing at once, jerky | “hurries”, “urgent motion”, “hand slides along the railing” | “steady, even pace… only at the very end of the shot she takes hold of the railing” |
| **S16** | runs away into the distance, the camera moves | 1) an added “awkward pause” scene; 2) “camera pans with her”; 3) extra seconds without action | the user's **short successful prompt** restored, “static camera… never changes its position” **3 times**, one line at the end: “until the end of the shot both stay at the spot” |
| **S4** | sparkles and stars | 1) the list “no sparkles, no glitter, no stars…” — **more** sparkles; 2) “pours hot water”, “boiling” → splashes on a dark background | all bans removed; positively: “matte surfaces, soft diffused light, calm air”; “a slow, thin, gentle trickle”; “crystalline” removed from the sound |
| **S6** | the first second is “mush” | 1) the raw prompt went in without refine; 2) no sleeves on the first frame, sleeves in the video | refine + **a new low-res video without sleeves**. Text did not fix it |

Shots that passed on the first try (S1, S3, S10, S11, S12, S15, S18, S22–S26) all followed the standard scheme, **with no additions to the refine** except binding the characters.

---

## 4. Checking the refine, point by point

### 4.1. `subject_definitions`
The most frequent error. The refiner mixed up which image is who (S2, S14, S19, S21, S28): bound a character to the first frame and the location to the portrait; shifted the numbers; once invented a fourth girl.

Template:
```
<Subject 1> is the young woman from @img-1 and @img-2 (her face and clothing as in @img-2), <hair, clothes>.
<Subject 2> is the <location> from @img-1 and @vid-1, <2–3 key objects>.
```
- A character ↔ their own `@img-N` + “(her/his face and clothing as in @img-N)”.
- The location ↔ `@img-1` and `@vid-1`.
- No names: gender and appearance.
- Several characters — one distinguishing detail each (red dress / glasses and grey sweater / blue embroidered jacket).

### 4.2. `retention_analysis`
`fully_preserved` everywhere. `partially_preserved` (“layout adapted”, “simplified”) and `attribute_transfer` give the model permission to change the frame. Replace them.

### 4.3. The body — stop words

| Word in the text | What the model does | Replacement |
|---|---|---|
| close-up, focusing on her face | moves the camera closer | static medium shot, not a close-up + a list of what is in the frame |
| looks around, glancing | turns the head | looks straight ahead, gaze stays fixed forward |
| hurries, urgent, frantic | jerks | steady, even pace |
| camera pans / follows | moves the camera | static shot, fixed camera (if the shot is static) |
| pours, boiling, splashing | splashes, glints | a slow, thin, gentle trickle |
| crystalline, glass, glint, shiny | sparks, shine | remove |
| an action already visible on the first frame | repeats it | already present in @img-1 and stays as it is |

### 4.4. Sound
Only the environment and the lines of characters in the frame. No voice-over, no “ringing” or “crystal” words.

---

## 5. What to write and what not

### Write (worked)
- **Camera stillness 2–3 times in different words**, at the start and at the end: “Static shot, fixed camera… does not move, pan, tilt, zoom or rotate… the camera position never changes”.
- **The composition**, if the model breaks it: what stands where and what stays in place to the end.
- **Timing of the action**: “for one second, then…”, “only at the very end”.
- **Gaze direction**, if it matters.
- **How the shot ends**, if the shot is longer than the action: one line “stays at the spot until the end” — no new events.
- **The needed state positively**: “matte”, “soft diffused light”, “calm air”, “steady pace”.

### Do not write (spoiled the result)
- **Lists of bans** (“no …, no …, no …”). H3 has no negative prompt in this mode (cfg = 1); such words work as hints.
- **New events to fill the time** (glances, pauses) — the character starts improvising and leaves the frame.
- **Atmosphere paragraphs** about light, mood, textures — the refiner writes them itself; additions blur the main point.
- **Contradictions with the video**: if water leaks in the low-res video, “the water does not leak” will not work.
- **Descriptions of people whose face is not visible**: a character reference from behind is not needed and only slows the render.

### Useless (checked)
- **The `first_frame` role** for the first frame — the result is identical to the `reference` role, and mentioning `@img-1` in the text breaks the face pass. Keep `reference` + the fixed phrase.
- **“The first frame must exactly replicate @img-1”** does not help if the first frame and the video disagree in content.
- **Repeating one demand more than 3 times** — after 2–3 repeats the effect does not grow.

---

## 6. Other settings that affect the result

- **Face pass** — off when there are no people in the frame: the detector found a “face” in a picture on a mug (S4) and redrew that area. On the board: variant `final_h3_768` has the face pass off, `final_h3_768_face` is the same 768 with the face pass on.
- **Character reference**: a 512×512 portrait for close-ups; for small faces, the character from the environment (already in the shot's clothes).
- **Duration** = the length of the low-res video. If there are more seconds than action, the model invents a continuation (S16). The board sets it from the video.
- **Seed** is random. If the result is almost good, first try a new seed, then edit the text.

---

## 7. Checklist before a run

1. The first frame and the low-res video agree (clothes, objects, light).
2. Refine from the original Wan prompt.
3. The fixed phrase comes first.
4. `subject_definitions`: each character ↔ their own `@img-N`, the location ↔ `@img-1` + `@vid-1`, no names, no extra characters.
5. `retention_analysis`: `fully_preserved` everywhere.
6. No stop words (4.3) and no lists of bans in the body.
7. Camera: if static, said 2–3 times.
8. The end of the shot in one line, no new events.
9. Face pass off if there are no people.

---

## 8. The board: what to return in `prompt.md`

Stage `final_render`, graph `playbooks/workflows/comfy/minimax_h3_creator_api.json` (one `MiniMaxH3Creator` node). Variants:

| id | What | When |
|---|---|---|
| `final_h3_768_face` | 768, face pass on | default, faces in the shot |
| `final_h3` | 1152, face pass on | faces, and the shot needs the higher resolution |
| `final_h3_768` | 768, face pass off | no people, small faces, faster or less memory |

`final_i2v` / `final_flf` (Wan) remain as a fallback. To propose another variant, write its id in `suggestedWorkflow` of `agent_request.json`.

**The board fills these in itself** — do not describe file names:

| Label | What | From |
|---|---|---|
| `@vid-1` | the low-res video | `video_preview/approve/` (newest) |
| `@img-1` | the first frame | `first_frame/approve/` (newest) |
| `@img-2`, `@img-3` | character references | `final_render/refs/` (by name), otherwise `characters/approve/`, at most two. No files — no label |
| duration | = the length of the low-res video | read from the mp4 |
| the sketch prompt | segment `prompt` and `refined.source` | metadata of the video in `video_preview/approve/`; if there is none, the sketch's `prompt.md` |

**`prompt.md` is the refine, split into sections. The board adds nothing.** Return exactly this, in English, no other headings:

```md
## body
[Shot 1] The scene begins from @img-1, the same camera position, the same frame, The first frame must exactly replicate @img-1. use @vid-1 as a reference, use the movements and the lighting changes from it. <the refined body: the Wan action rewritten in the Context-IR style, checked against 4.3>

## subject_definitions
<Subject 1> is the young woman from @img-1 and @img-2 (her face and clothing as in @img-2), <hair, clothes>.
<Subject 2> is the <location> from @img-1 and @vid-1, <2–3 key objects>.

## summary
[video editing] The target video is an edited version of @vid-1: <one sentence: shot type, who, what they do>, re-rendered at much higher quality.

## retention_analysis
<Subject 1> (appears in [Shot 1]): fully_preserved - <what is retained>.

## soundscape
<environment sound only; the lines go in ## body>
```

Rules:
1. `## body` is required. Text without headings counts as the body.
2. Write `subject_definitions`, `summary`, `retention_analysis` (section 4). An empty or missing one is derived by the node, which is where the refiner errors come from.
3. `@img-N` numbers follow the table above. Two characters: `@img-2` is the first by file name, `@img-3` the second. A character whose face is not visible gets no reference: say so in the message to the user instead of inventing a label.
4. Start from the approved sketch prompt (the video metadata; if it has none, `video_preview/prompt.md`), not from an older final.
5. No Russian text: the board refuses such a `prompt.md`. The only exception is the lines below.
6. Lines: see «Dialogue» below. No lines — `## soundscape` is the environment only.

**Dialogue** (the shot has lines in `speech.md`, section «Реплики» / `Lines`). MiniMax voices the shot and moves the lips itself, so every line goes into `## body` word for word, as a numbered dialogue, in the node's own grammar (Continuity refine guide: `families/h3/prompts/base-en.txt`, §4.4): the speaker by look and position in the frame, a stable speaker ID `(S1)`, `(S2)`, and the words inside `<d>[English] …</d>`. Use the first frame prompt from the task to know who is on the left and who is on the right. The ambient sound goes to `## soundscape`, never the lines (the guide: dialogue belongs in the description and is not repeated in the soundscape).

```text
1. The young woman on the left (S1) says: <d>[English] Don't mind him. He just wants the attention. And you gave it to him.</d>
2. The young woman on the right (S2) says: <d>[English] But why?</d>
3. The young woman on the left (S1) says: <d>[English] Everybody wants it. I am Julia, by the way.</d>
4. The young woman on the right (S2) says: <d>[English] I am Lena. Nice to meet you.</d>
```

`## soundscape`: `Ambient sound of a quiet lecture hall, soft whispers and intimate conversation.`

Do not translate, shorten or add lines. A speaker keeps the same ID for the whole shot. The board refuses to run H3 when a line of `speech.md` is missing from `prompt.md`. One speaker defaults to H3 (`final_h3_768_face`); two or more default to HeyGen (`final_heygen`, and the cloud runs only after the user ticks the box for this one run); nobody speaking defaults to Wan (`final_wan_720`). An LTX sketch wins: the default is then `final_ltx`. If the selected variant is not that one, write `suggestedWorkflow`. The table is in `playbooks/stages/final_render.en.md`.

**`## summary`** for this pass starts with the task type `[video editing]`: `The target video is an edited version of @vid-1: the same motion and composition, re-rendered at much higher quality, with the lips re-animated to the dialogue.`
