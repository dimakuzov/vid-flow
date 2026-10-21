# LTX 2.5 — how to write the video prompt

English copy for the model. Russian original: `playbooks/models/ltx_video.md`.

Source: ComfyUI-Continuity, `creator/families/ltx25/prompts/craft.txt` (how LTX 2.5 is written) and `prompts/modes/i2v.txt` (the start frame is the first frame). Both board workflows use this caption: `video_ltx` on `video_preview` and `final_ltx` on `final_render`, graph `ltx25_i2v_api.json`. The board sends `prompt.md` as one string to node `398:376`. Continuity joins the paragraph, the soundscape and the music the same way (`plain_prompt`): sentences one after another, no field names.

## What the model reads

The caption is always English. The task, the scenario and the notes may be Russian. Do not translate any of it into Russian: not the description, the camera, the sound, or the spoken lines.

One flowing paragraph. Present tense, for the action, the camera and the sound. No headers, no bullet points, no numbered beats, no labels such as `Audio:`, `Visual:`, `Shot:` or `Camera:`, no timestamps, no file names, no paths, no image numbers. A label standing where a description should be is a token sequence these weights were trained never to see.

Say it in this order, inside the sentences:

1. **Establish the shot.** Open with the framing, in the vocabulary a crew would use: wide establishing shot, medium close-up, low-angle shot, over-the-shoulder, overhead view, static frame, handheld. If the task implies a category (stop-motion, documentary, period drama), name it and then describe the look it actually has.
2. **Set the scene.** Lighting, colour palette, surface texture, atmosphere. One light source and what it does, not three that contradict each other. Fog, rain, dust, smoke and particles belong here.
3. **Define the people.** Age, hair, clothing, build, a distinguishing feature, in the sentence they first appear in. Emotion is one small physical cue at natural strength — a jaw tightening, a hand hesitating — never an abstract label. Scenario words like `fanatical`, `dramatic`, `in a panic`, `sharply` become a quiet cue, not a bigger movement: `she looks up from the notebook, her eyes certain`. A gesture is written only when the scenario or a note names it. Give every gaze a target in the frame (`looks at the man in the blue jacket`, `looks ahead along the path`). Nobody looks into the lens unless the task says so. Reuse the same identifier every time someone reappears (`the woman in the yellow raincoat`, not `she`, and not a character name).
4. **Describe the action.** What starts, what changes, what it settles into. One sustained action reads better than four crowded ones. Every person who has no action in the shot gets one sentence that holds them: `the woman in the black leather jacket stands on the same spot until the end of the shot, her arms at her sides`. Give a standing person's place as a spot next to something in the frame (`beside the bench on the right`), not as a part of a route (`halfway down the path`, `far down the walkway`): route words make the model walk them. The main movement starts at the opening moment: write it right after the opening image, with `at once`, `from the first moment`, `right after the line`. Do not open the action with a pause or a preparatory step (`Initially she stands upright, then…`) unless the shot is about that pause. Order the rest in words — `a moment later`, `simultaneously`, `by the end` — not by timestamps. When someone must leave the frame, say where and that they are out of it before the end: `she passes the left edge of the frame and is gone, the steps empty`. When two people move, give each one their pace and say how the distance between them changes: `she walks briskly toward the door; he follows at a slow walk, and the gap between them grows the whole time`. Do not add catching up, closing the gap or walking side by side unless the task says so.
5. **Move the camera.** Say how and when it moves, relative to the subject: follows, tracks, pans across, pushes in, pulls back. Then say what is in frame after the move. A shot that does not move says so in the opening framing (`A static medium close-up opens on…`), not as a separate label. Without a camera move in the task, the shot is static from the first word to the last: write no push-in, drift or zoom.
6. **Speech.** Whenever someone speaks, write the words in English inside double quotation marks, in the sentence that describes them saying it: `She whispers, "He's late."` Lines from the task (section «Lines», from `speech.md`) are said in English, in order, even when `speech.md` is Russian. Do not copy the Russian wording and do not name the language. No lines in the task — nobody speaks, do not invent any. About two to three words of speech per second of the shot, so the line finishes inside it.
7. **Length.** One continuous take is roughly four to eight sentences. A close-up wants more detail than a wide. On-screen text comes out unreliably, so keep any lettering short. Prefer motion that is plausible and readable.

## First frame (preview and final)

The approved first frame is the video's literal first frame. Open on exactly that image — its subjects, clothing, colours, key objects, light and composition — before anything moves, then develop forward from it. Identity, wardrobe, palette and spatial relationships stay consistent with the frame throughout. The task lists what the approved first frame shows; follow that, not a scenario line that disagrees with the picture. The light and the weather stay as in the frame for the whole clip unless the task changes them. A person who is not in the frame enters it on foot from an edge (`walks in from the left edge of the frame`); never write that someone appears. The number of people in the frame at the end is the number the task gives; say it in the last sentence when someone enters or leaves: `he is the only person in the courtyard`.

Prefer one continuous take. The opening image is what the generation is anchored to, and a cut away from it early gives that anchor nothing to hold. Write a cut only when the task asks to leave the frame. Then, in the same paragraph: name the transition (`A hard cut transitions to…`, `The view cuts to a close-up of…`), re-establish the new shot (scale, angle, who is in frame, the light if it changed), reuse the same visual identifier, and say what happens to the sound. Do not invent cuts.

## Sound

After the paragraph, append the soundscape as one to four sentences, with no label. Ambience of the place, the surfaces the action touches, clothing, footsteps, breathing, weather, machinery — described as heard events. Spoken lines stay in the paragraph with the person saying them. Music only when the task asks for a score, a song or an instrument playing over the scene: then instrumentation, tempo, rhythm and how it changes, also as sentences with no label. Otherwise write no music and leave the choice to the model. Music the characters can hear — a radio, a band on stage — belongs in the paragraph.

## Words that make the model overdo it

| Word in the text | What the model does | Write instead |
| --- | --- | --- |
| snaps, sharply, abruptly, jerks | a jolt of the whole body | turns, lifts, at an even pace |
| hurries, frantic, in a panic | runs, flails | a brisk, steady walk |
| dramatic pause, fanatical, theatrical | stage acting, big faces | one small cue on the face |
| spreads her arms, waves, gestures | waves the arms for the whole clip | hands at her sides, unless a gesture is the point |
| appears, emerges, materialises | a second copy of the person, a figure out of nowhere | walks in from the left edge of the frame |

## What the board adds

The board sets the duration (the stage menu, otherwise `N sec` in `prompt.md`; LTX is 2–10 s). When the task says the duration was chosen in the menu, do not write `N sec` or a timestamp. The action and the lines must fit that duration.

`video_ltx` is the sketch. `final_ltx` is the same graph at 1.2 MP: node `403` `megapixels` is 1.2, aspect stays `9:16 (Portrait Widescreen)`, multiple stays 32, which is 832×1504, and `398:361` is 24 fps. Write the final caption by these same rules. When an approved sketch video exists, the board copies its caption from the file metadata into the final and does not rewrite it; with no metadata it uses the sketch `prompt.md` and notes that in `run_log.md`. A later edit of `prompt.md` without a new video does not reach the final. Do not feed this caption to a Wan final. If another final is selected and the sketch is LTX, write `final_ltx` in `suggestedWorkflow`. The board does not switch by itself.

## Example

The form, from the i2v mode. None of this scene belongs in a reply unless the task or the first frame contains it. The picture is an elderly potter's hands on a lump of wet clay, a still wheel, a dim workshop, one window. The request is: he starts the wheel and shapes a tall vase, slow and calm.

```text
A static medium close-up opens on the elderly potter's weathered hands cupped around a lump of wet grey clay on a still wheel, in a dim wood-beamed workshop lit only by soft daylight from a single small window to the left; the palette is muted brown and grey with one cool highlight along his knuckles. The wheel begins to turn and his palms press the spinning clay inward, water sheening over his skin. The camera pushes in slowly as the clay rises under steady pressure, his thumbs opening the mouth and his fingers drawing the wall upward. A tall slender vase turns evenly on the wheel and his hands lift away, trembling slightly, leaving it spinning in the window light. The potter's wheel hums with a low mechanical whir over the wet slip of clay against skin. Water drips from his fingers into a tray below, and the old workshop holds a quiet wooden room tone.
```

The paragraph opens on the frame and only then moves. Slow and calm became pacing, camera and sound, not adjectives. It stayed one take.

## Example with lines

```text
A static medium shot opens on the young woman with the braid standing by the window, her back to the wall, looking at the man in the white jacket; cool daylight from the window is the only light. She says, "Who are you?" A moment later the man in the white jacket takes one slow step towards her and answers, "You don't remember me?" They hold each other's look. The room is quiet except for the floorboard under his step.
```

## Before a run

1. One paragraph, present tense, no labels, lists or timestamps.
2. It opens on the approved first frame, then the action moves forward from it.
3. People keep one visible feature; no character names; emotion is a physical cue.
4. One sustained action with an end. The camera is said relative to the subject, then the frame after the move.
5. Every line from the task, in English, in double quotes, inside the sentence; nothing translated into Russian; no lines invented.
6. The soundscape is appended, unlabeled, one to four sentences. Music only if the task asked.
7. About four to eight sentences. No `N sec` when the menu set the duration.
