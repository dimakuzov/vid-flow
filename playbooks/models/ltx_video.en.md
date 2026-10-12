# LTX 2.5 — how to write a prompt for a video sketch

English copy for the model. Russian original: `playbooks/models/ltx_video.md`.

Board manifest: `video_ltx` (stage `video_preview`), graph `playbooks/workflows/comfy/ltx25_i2v_api.json`: LTX 2.5 distilled, image to video, 24 fps, two passes with a latent upscale, with sound. The first frame is the newest file in `first_frame/approve/`.

There is no history of LTX runs on this project yet. The rules below are the Wan rules that carry over (`playbooks/models/wan_video.en.md`), plus the shape of the first LTX prompt the user wrote. Add what the runs show.

## Template

```text
use image as the first frame. <who, by one visible feature> <start state, exactly as on the first frame>. <action 1>. Then <action 2>. Static camera. <end state of the shot>. Realistic, natural movement.
```

1. **The first words are always `use image as the first frame.`** This is how the user's working prompt starts.
2. **The camera, one short sentence:** `Static camera.` If the shot needs a camera move, write exactly one move and its speed.
3. **Start = first frame.** The action starts from what is already in the picture: the same places, poses and the same direction people face. The task lists what the approved first frame shows; follow it, not the scenario's wording.
4. **People by one visible feature, not by name:** `the young woman with a long braid`, `the man in the white jacket`. Take the feature from the first frame description.
5. **One or two actions, in order, with links:** `First… Then…`. Without links the model does everything at once.
6. **Say how far a movement goes:** `runs past the left side of the camera and leaves the frame`, `takes two steps towards the window`. LTX finishes the clip with motion; an open-ended action keeps going.
7. **Nothing appears that is not on the first frame,** unless the shot needs it; then say where it comes from (`a man enters from the dark archway in the background`).
8. **Speech.** LTX makes the sound itself and can make a person speak. If the task has lines (section «Lines», from `speech.md`), put every line into the prompt: who says it and the words, in the order they are spoken. Nothing more: no voice, tone or accent descriptions.
   - Who: the same visible feature as in the action (`the young woman with the braid`), not a name.
   - The words exactly as in `speech.md`, in their language, in double quotes.
   - The order through links: `says: "…"`, `Then the man in the white jacket answers: "…"`.
   - Put the lines where they happen in the action. No lines in the task — nobody speaks, do not invent speech.
9. **Other sound (optional).** One short sentence if it matters: `Heavy rain, footsteps on wet stone.` No music unless asked.
10. **Length:** 50–90 words, not counting the spoken lines. A long prompt makes the model act out every word.
11. **Duration:** the board sets it (menu of the stage, otherwise `N sec` in prompt.md). When the task says the duration was chosen in the menu, do not write `N sec`. The action and the lines must fit into it.
12. **No file names, no paths, no image numbers other than `image`.**

## Example (the user's first LTX prompt, shortened)

```text
use image as the first frame. The frightened young woman in the foreground bursts into action and runs fast, straight forward, past the left side of the camera, and leaves the frame. At the same moment the dark silhouette in the coat and hat in the distant background breaks into a sprint after her. Static camera. The backlight and the rim light on the pursuer stay as they are. Realistic, natural movement.
```

## Example with speech

```text
use image as the first frame. The young woman with the braid stands by the window, her back to the wall, and looks at the man in the white jacket. She says: "Кто вы такой?" Then the man in the white jacket takes one slow step towards her and answers: "Ты меня не помнишь?" Static camera. They keep looking at each other. Realistic, natural movement.
```

## Before a run

1. Starts with `use image as the first frame.`
2. The start matches the approved first frame: positions, facing, poses.
3. People by one visible feature.
4. One or two actions with links, each with an end.
5. `Static camera.` or exactly one camera move.
6. Every line from the task, word for word, in quotes, with who says it and in what order; no lines invented.
7. 50–90 words besides the lines; no `N sec` if the duration is chosen in the menu.
8. 2–3 seeds at once.

## Final (`final_ltx`)

The same graph, `ltx25_i2v_api.json`. The board defaults to it when the approved sketch was made with this graph (the video metadata has non-empty text in node `398:376` / `value`; with no metadata, the file name contains `_ltx`). Lines do not override that.

Resolution and frame rate are constants in the manifest, as with `final_wan_720`: width 768 and height 1344 in nodes `398:372` and `398:360`, 24 fps in `398:361`. The graph divides the size by 2 for the latent and brings it back with a ×2 upscale, so both sides must be divisible by 64. 720×1280, the Wan final, is not (half of 720 is 360, and 360 is not divisible by 32). 768×1344 is. It is not exactly 9:16 (9:16 and divisibility by 64 together give the next step, 1152×2048). The duration is the approved sketch's length, 2–10 s.

The final does not rewrite the prompt: it takes the text from the approved video's metadata. No metadata — the sketch's `prompt.md`, with a note in `run_log.md`. A prompt that starts with `use image as the first frame.` does not belong in a Wan final: for an LTX sketch the board selects `final_ltx`.

If another final is selected and the sketch is LTX, write `final_ltx` in `suggestedWorkflow`. The board does not switch by itself. The full table is in `playbooks/stages/final_render.en.md`.
