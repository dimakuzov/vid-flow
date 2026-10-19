# Wan 2.2 — how to write a prompt for a video sketch

English copy for the model. Russian original: `playbooks/models/wan_video.md`.

Built from the EP.1 sketches (S1–S28): what worked on the first try, what was redone 5–17 times, and what finally worked. Sketches are made only with Wan 2.2 i2v (turbo). MiniMax is not used for sketches.

Board manifests that use this playbook: `video_i2v`, `video_flf` (stage `video_preview`), `final_i2v`, `final_flf` (stage `final_render`). The exact `prompt.md` template is section 8.

---

## 1. What the shots showed

| Result | Shots | What solved it |
|---|---|---|
| First prompt worked | S6, S21, S22, S2 (FLF) | A simple action, one or two phases, everything starts from what is already on the first frame |
| Same prompt, new seed | S21, S22, S24, S17, S7 | The prompt was right, the seed was unlucky. 3–5 seeds were enough |
| Only the duration (±1 s) | S24, S7, S13 | The pace changed, the text stayed |
| Prompt rewritten 3–7 times | S3, S7, S9, S15, S25, S28 | Extra words removed, the main movement named directly, its strength limited |
| First frame changed | S11, S12, S25 | The action contradicted the start state |
| Wan could not do it | S4 (crack), S5 (burned by a spoon), S16 (collision), S19 (walk up to the camera) | Moved to a last frame (FLF), MiniMax or Seedance |

**Main lesson:** almost no redo happened because the prompt was too short. The prompt had extra words, and the model acted out every one of them, harder than needed.

Approved prompts have **55–90 words**. Above 100 words the result was worse or no better.

---

## 2. Prompt structure (from approved shots)

```
[Camera]. [Who/what, by look, short] [start position — as on the first frame].
[Action 1]. [Link: Then / Only when… at that moment] [Action 2].
[End state of the shot].
Realistic, natural movement.
```

1. **Camera is always the first sentence.** `Static shot, fixed camera.` If the shot list moves the camera, write exactly one movement and its speed: `The camera follows behind her.` / `The camera pans very slowly, lagging behind her.`
2. **A character by visible features, not by name:** `the young woman in the floral nightgown`, `the girl in the red dress`. One feature is enough; the model sees the rest on the frame.
3. **Start = first frame.** The action starts from what is already in the picture. If the tights are already on, she *pulls them up*, she does not put them on (S11). If the note is already lying there, it cannot “fall” (S25).
4. **Order of actions through links:** `First… Then…`, `Only when he is bent that low does he lift his head, and at that very moment she…` (S17, S9). Without links the model does everything at once.
5. **The end of the shot is its own sentence:** `She stops close in front of the camera and stands still.` / `The shot ends on…` Otherwise the model invents a continuation.
6. **Tail:** `Realistic, natural movement.` If a pace is needed: `…slow movement` or `…sharp sudden movement`.

### Reference (S6, approved on the first try)
```
Static shot, fixed camera, top-down view. Her pale wet hands are held open above the old sink, faint smears of fresh blood on the palms and fingertips, a thin stream of water running from the tap. She looks at her hands, motionless, for one second. Then she puts her hands under the running water and quickly rubs her palms and fingers together, washing the blood off; the faint pink traces rinse away fast and her hands become clean. The water in the sink stays clear. Realistic, natural movement.
```
Why it worked: camera, start state, a pause with a duration, a second action through `Then`, an end state, and amounts given by measure (`faint`, `thin`, `fast`).

---

## 3. Rules that actually changed the result

### 3.1. Everything named moves and appears
- **S3:** “the lid trembles slightly, the edge does not lift” → the lid was thrown up. Only **not mentioning the lid at all** helped.
- **S28:** “follows with her eyes someone who walks past” → a man appeared in the frame. Write `watching something far away, beyond the frame`.
- **S23:** “flinches slightly” → became a sigh.

👉 Do not name an object or a body part that must not move. A negation inside a positive prompt often does not help: `only one door opens, the near door stays shut` failed in S9, the second door still opened.

### 3.2. The main movement — directly and first
S3 worked only with `The kettle is shaking: the whole kettle visibly shakes and trembles…`. While the shaking was a subordinate clause, the model ignored it.

### 3.3. Give strength as a measure, not an emotional word
The model pushes emotional words to the maximum:

| Was (bad) | Became (approved) |
|---|---|
| `takes a big deep breath` → shoulders rose | `takes a quiet, slight breath in, barely visible; her shoulders stay completely still` (S7) |
| `behaves flirtatiously, bats her eyelashes` → too much | `her surprise slowly softens and she gives a slight, faintly playful smile` (S28) |
| `steady stream of steam` → a steam engine | `a thin, gentle wisp of white steam` (S3) |
| `rolls a little` → rolled off the table | `rolls only a tiny bit, a couple of centimeters, and stops right there on the notebook page` (S25) |
| `water turns dark red` → a horror film | `faint pink traces rinse away fast… the water stays clear` (S6) |

👉 Use `slight`, `barely visible`, `a couple of centimeters`, `for one second`, `thin`, `faint`.

### 3.4. Every moving object needs a “doer”
S9: the wardrobe doors opened by themselves. Only this worked:
`The doors never open by themselves; each door opens only when her hand pulls it. First, with one hand, she pulls open the far door. Then she brings her other hand up to the second door…`

### 3.5. Describe stillness as a positive state
S15: while the prompt said “stopped”, she kept walking and a second hand appeared. This worked:
`She has stopped and stands completely still, frozen in place: her body and her feet do not move at all… Only one hand is in the frame… no other hand appears at any moment.`

👉 First the positive state (`stands completely still`, `only one hand is in the frame`), a negation only as a clarification after it.

### 3.6. The model finishes the action
S10: the braid kept getting finished by the end. Solution:
- `continuously… the whole shot… her hands stay in the middle of the braiding the entire time; the braid is not finished`;
- generate 1–2 s longer and cut in the edit.

### 3.7. Control the pace with duration, not words
- Came out slow → **shorter** duration (S7: 5 → 3 s).
- Needs to be faster → the words `fast, at a brisk pace` **plus** one second longer and a speed-up in the edit (S13).
- Too fast and the action does not fit → +1 s (S24).

---

## 4. Useless to write (wastes tokens and hurts)

| What | Why |
|---|---|
| **Negative in turbo mode** | Turbo uses CFG = 1, and at CFG 1 the negative prompt **does not take part in generation**. None of our negative additions for turbo changed anything; only the positive helped. A negative matters only in full mode (CFG 3.5) |
| Interior, light, clothing, appearance | Already on the first frame. Official Wan i2v formula: **prompt = movement + camera** |
| Sound, lines, voice-over | Wan has no sound. A line at most as “says something short and strict” (S24) |
| Character names | The model does not know them |
| Style words (`cinematic`, `8K`, `film grain`) | No effect on the sketch; the first frame sets the style |
| Repeating one thing in other words | The extra length blurs the main action |
| Negations without a positive | “does not back away”, “one door” — the model sees the word and does it (S9) |

---

## 5. When a prompt cannot solve it — another path right away

Sign: two or three rewrites give no shift, the model stubbornly does it “its way”. The action contradicts its usual picture of the world.

| Task type | Example | What to do |
|---|---|---|
| Change of an object's state | A crack without breaking (S4) | A last frame with the needed state → FLF |
| An action against habit | Bring a spoon up and not eat (S5) | A last frame, another shot, or drop it |
| Physical contact of two people | Collision (S16) | Seedance / a reference video |
| A character walks to the camera into a close-up | S19, S2 | FLF. If the walk looks like a catwalk — Seedance |
| A specific end pose is needed | S2, S19 | FLF (first + last frame) |

---

## 6. Process

1. First round: **2 turbo variants**.
2. If close — **3–5 new seeds** with the same prompt (this solved S21, S22, S24, S17).
3. If wrong — change **one thing per round**: the text, or the duration, or the first frame.
4. Every change follows section 3: remove the extra, name the main thing, limit the strength.
5. **No full run (20 steps, no turbo):** it usually comes out worse. The best turbo variant goes straight on.

---

## 7. Wan 2.2 settings

- **Turbo:** LoRA lightx2v 4 steps, CFG 1, split 2. Sketches only like this.
- **Sketch resolution:** 576×1024 (set by the `video_i2v` / `video_flf` manifests; the graph file still says 384×672). The final Wan variant `final_wan_720` renders 720×1280 at 24 fps (the sketch is 16 fps): 1.5 times as many frames for the same length. Measured on s03 with the same prompt and seed: 432×768 — 35 s, 576×1024 — 70 s, 720×1280 — 128 s. At 720×1280 Wan invents background details, so the board ends the final prompt with: `The background stays exactly as in the first frame for the whole clip: no new people appear, nobody walks or moves in the background, doors, windows and curtains stay as they are, and no new objects appear. Only the movements described above happen.`
- **FPS 16, length = duration × 16 + 1:**
  - 3 s = 49 frames;
  - 5 s = 81 frames;
  - 6 s = 97 frames.
- **Up to 5 seconds** the model is most reliable: it was trained at that length. 6–7 s work. At 8 s S2 got worse; the 6 s variant was approved.
- **The first frame must be exactly 9:16.** If it is not, WanImageToVideo stretches it to the run size (576×1024 for the sketch). Our frames 1152×2080 are slightly off 9:16.
- **FLF (first + last frame):** a separate graph `wan22_flf_sketch_turbo_api.json`. It is the same graph with `WanFirstLastFrameToVideo` instead of `WanImageToVideo` and an `end_image`. All other nodes and settings are the same. An FLF prompt describes only the transition, not the frames.

---

## 8. `prompt.md` template (board text mode)

The board puts `prompt.md` into the positive prompt node (`129:93`) **as is**: no camera sentence added in front, no tail added, names not replaced. `prompt.md` is the whole positive prompt. The negative, steps, CFG, LoRA and size come from the graph and do not change.

### What to return

Only the prompt text. One paragraph in English. Do not translate any of it into Russian. 55–90 words, never more than 100. No headings, quotes, markdown, lists, or notes to the user.

### i2v template (`video_i2v`, `final_i2v`)

```
<Camera sentence>. <Who, by one visible feature> <start state, exactly as on the first frame>. <Main action, named directly>. Then <second action, if any>. <End state of the shot>. Realistic, natural movement.
```

### FLF template (`video_flf`, `final_flf`)

```
<Camera sentence>. <Who, by one visible feature> <start state>. <The transition in one or two phases, linked with Then>. The shot ends as <end state, matching the last frame>. Realistic, natural movement.
```

FLF describes only the movement between the frames. Do not describe what is on either picture.

### Rules

1. The first sentence is the camera. If `shot.md` says nothing about the camera: `Static shot, fixed camera.` A moving camera: exactly one movement and its speed.
2. The last sentence is `Realistic, natural movement.` For a pace: `Realistic, slow natural movement.` or `Realistic, sharp sudden movement.`
3. Characters from `shot.md` are named by look (`the girl in the red dress`), never by name. The board no longer replaces names.
4. Only movement and camera. No interior, light, clothes, style words, sound, lines, voice-over. A line at most as `says something short`. If the task has lines (section «Реплики», in text mode `Lines`), show the speaker talking at that moment of the action (`she says something short, her lips moving`), never quote the words: Wan has no sound and may draw the text. Leave time for the lines (about 2–3 words per second); if they do not fit the clip duration, say so to the user instead of rushing the action.
5. Strength as a measure (section 3.3). Stillness as a positive state (3.5). Every moving object has a doer (3.4).
6. The start state must match the first frame from `first_frame/approve/`. If the message contradicts the frame, write the action from what is on the frame (she pulls the tights up, not puts them on).
7. Duration. If the task gives a clip duration chosen in the board menu (`clip duration: N s`, in `llm_task.md`: «Длительность клипа: N с»), the board sets it in the graph itself: do not write `N sec` in `prompt.md`, and pace the action to fit exactly that time (fewer phases for 2–3 s, a calmer pace, a second phase or a held end state for 9–12 s; past about 8 s Wan tends to loop or freeze, so give it real action for the whole time). Without a menu choice the default is 5 s from the graph. Write a duration then only when the shot needs another one: put `N sec` (2–12) as the very last words, after the tail, for example `Realistic, natural movement. 3 sec`. The board reads the first such number. That text also reaches the model; keep it to these two words. Do not write other numbers followed by `s` or `sec`.
8. Write the template of the workflow you were given (i2v or FLF). Choosing between them: `playbooks/stages/video_preview.en.md`.

### Example (i2v)

`shot.md`: “Katya wakes up and sits up in bed.” First frame: a girl lying in bed under a blanket.

```
Static shot, fixed camera. The girl with dark braided hair lies on her back in bed under a striped blanket, eyes closed. She slowly opens her eyes and looks at the ceiling for one second. Then she pushes herself up on her elbows and sits up, the blanket sliding down to her waist. She stays sitting upright and still, looking straight ahead, not at the camera. Realistic, slow natural movement.
```

### Example (FLF)

First frame: a boy at the door. Last frame in `refs/`: the same boy close to the camera.

```
Static shot, fixed camera. The boy in the grey coat stands by the door at the back of the room. He walks toward the camera at an even pace, straight along the middle of the floor, arms relaxed. The shot ends as he stops close in front of the camera and stands still, looking slightly to the left. Realistic, natural movement. 4 sec
```

## Which variant to suggest

The board does not switch by itself. If the selected variant does not fit, write its id in `suggestedWorkflow`. The full table is in `playbooks/stages/video_preview.en.md` and `playbooks/stages/final_render.en.md`.

| Situation | id |
| --- | --- |
| Sketch: a simple move, nobody speaks | `video_i2v` (the board already defaults to it) |
| Sketch: a specific end pose is needed | `video_flf` |
| Sketch: someone speaks, or the shot needs sound | `video_ltx` |
| Final: the sketch was made with LTX | `final_ltx` |
| Final: nobody speaks, the sketch is Wan | `final_wan_720` |
| Final: one speaker | `final_h3_cinema` |
| Final: two or more speakers | `final_heygen` (the cloud runs only after the user ticks the box for this one run) |

An LTX caption is the paragraph in `playbooks/models/ltx_video.en.md`: it opens on the framing of the first frame. Do not paste it into Wan.
