# Stage: first_frame

English copy for the model. Russian original: `playbooks/stages/first_frame.md`.

Build the start frame: place the approved shot characters into the approved shot location. Prompt: `playbooks/models/qwen_first_frame.en.md`. Graph: `playbooks/workflows/first_frame_comfy.en.md`.

## Where the pictures come from

Not from the raw libraries. Those have a different angle and different clothes.

- Location: the one file in `shots/{shotId}/location/approve/`. This is image 1.
- Character: `shots/{shotId}/characters/approve/{name}_{shotId}.png`. The first is image 2, the second is image 3.

Copies go in this stage's `refs/`: `location.png`, `{name}.png`. A manual approve can skip the upstream check, but the graph still receives these shot frames, not `view.png` and not `full_body.png`.

## Shot contract

```text
shots/{shotId}/first_frame/
  refs/  output/  approve/
  prompt.md  llm_notes.md  refs.md  workflow.md  status.json
```

`workflow.md` is an optional note.

Run variants go in `output/` as `{shotId}_ff_v1.png`, `{shotId}_ff_v2.png`, and so on. The chosen file is `approve/{shotId}_first.png`.

There is no `video/first_frames/` folder. Older notes kept round prompts in `prompt_qwen21.txt`. Here the round prompt is `prompt.md`.

## Two modes

**Assembly.** image 1 is the clean location. image 2 and image 3 are the characters. Use this when place, size, pose, direction, or the number of people changes.

**Edit.** image 1 is an already good frame from `output/`. The prompt describes one change. Use this for light, a small detail, or brightness.

No more than one or two edits in a row. The background goes soft. If pose or size must change, go back to assembly from the clean location.

One character: do not connect image 3. Two characters: both references, and say who is on the left, who is on the right, and where each one walks.

A single character in a simple pose on an obvious spot usually works on the first run. Two people, a small physical detail, and the surface the character stands on take longer.
