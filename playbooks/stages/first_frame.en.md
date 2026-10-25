# Stage: first_frame

Build the start frame. When the shot has approved characters and a location, place them into it. When it has no specific characters and no location, make the frame directly. The earlier stages are not required. Prompt: `playbooks/models/qwen_first_frame.en.md`. Graph for compositing existing pictures: `playbooks/workflows/first_frame_comfy.en.md`.

## Goal: only add the characters

The reference pictures win over the shot text.

- The location from `location/approve/` is used as it is: the same angle and framing, the same objects in the same places, the same light and colours. Nothing added, removed or moved; the buildings and the room are not redrawn; the light and the weather do not change.
- The characters wear the same clothes and carry the same items (bag, hat, shoes) as on their references in `characters/approve/`. Do not describe clothes in the prompt, only «as in image N».
- When the shot text (shot.md) differs from the references — in clothes, light, weather or objects — the references are right.
- Change clothes, items, the light or the location only when the user explicitly asks, and only what they named.

The board helps with this. A model with vision describes the approved location, characters and first frame right after they are approved (`data/descriptions/`, once per file). Before the agent task it merges the shot's scenario text, these descriptions and the user's notes into one action, `shots/{shotId}/action.md` ("Action from the pictures" on the stage page; the user can edit it). The agent task has all three and every earlier note for the shot. Priority: the user's request, the user's earlier notes (a later one wins), what the pictures show, the adapted action, the shot.md text.

How to write this in the prompt: `playbooks/models/qwen_first_frame.en.md`, sections «First: the references win over the text», «Clothes and items», «Light», «Lock».

When the location is approved and `shot.md` names no characters, the board runs the same graph with only the location (image 1). The prompt adds only what the shot action and the user's request ask for, and does not describe the place anew (`Top-down view of wet asphalt…`): the model will draw a different location. When the shot names characters, the run does not start without their `characters/approve`.

## No character and no location

`shot.md` has empty `characters` and `location`, or the user said to make the frame now. Do not wait for `characters/approve` or `location/approve`. Do not create those stages. Do not invent a person's name or a place name that is not in the message.

Build the picture from the shot text and the files in this stage's `refs/`. Put the result in `output/`. The chosen file goes in `approve/`. The character-into-location graph is not required for this path.

## Where the pictures come from

Not from the raw libraries. Those have a different angle and different clothes.

- Location: the one file in `shots/{shotId}/location/approve/`. This is image 1.
- Character: `shots/{shotId}/characters/approve/{name}_{shotId}.png`. The board takes them in alphabetical order of the file name: with `julia_s05.png` and `lena_s05.png`, Julia is image 2 and Lena is image 3. In prompt.md they are character1 and character2 in that order. The agent task lists the numbers under «Images the graph receives». The names are for the task only.
- Portrait: the character's face, after all the characters, in the same order (image 3 for one person, image 4 and image 5 for two). The board always sends it when one exists. Source: `refs/{name}_face.png` of this stage, otherwise the portrait in `data/characters/{name}/` (`portrait.png`, `portret.png`, `{Name}_portret.png`, `face.png`). Rules: `playbooks/models/qwen_first_frame.en.md`, «Portraits».
- The graph takes up to 6 images: the location and 5 references in a row, with no gaps in the numbers. The task names anything that did not fit. A file removed with "Remove" does not go to the graph and takes no number.

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

**Assembly.** image 1 is the clean location, then the characters and their portraits as listed under «Images the graph receives». Use this when place, size, pose, direction, or the number of people changes.

**Edit.** image 1 is an already good frame from `output/`. The prompt describes one change. Use this for light, a small detail, or brightness.

No more than one or two edits in a row. The background goes soft. If pose or size must change, go back to assembly from the clean location.

Name every image from the list in the prompt by its number. Two characters: both references, and say who is on the left, who is on the right, and where each one walks.

A single character in a simple pose on an obvious spot usually works on the first run. Two people, a small physical detail, and the surface the character stands on take longer.
