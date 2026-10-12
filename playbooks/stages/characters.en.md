# Stage: characters

English copy for the agent. Russian original: `playbooks/stages/characters.md`.

A shot variant of a character: the clothes of this shot. Face and body come from the base asset, the clothes from a reference in `refs/` or from text. The character stands straight, full length, on a light background: the pose and the place in the frame are set by the `first_frame` stage, not this one.

The board runs the pass: manifest `character_outfit`, graph `playbooks/workflows/comfy/character_outfit_qwen21.json`. The agent writes only `prompt.md` (sections `## name`). The user approves. The teaser s07 characters were made this way.

## Dependency on the base

The character canon lives outside the shot:

```text
data/characters/{name}/
  portrait.png     # face, front (portret.png in the source notes)
  side.png         # face, profile (portret_side.png)
  full_body.png    # full length, light background
```

The variant in `data/episodes/{episodeId}/shots/{shotId}/characters/` is built from this base. Image 1 is one picture: this shot's `refs/{name}_base.*` when it exists, otherwise `full_body.png`, otherwise `body.png`, otherwise the first picture in the folder whose name has no `copy`. The board does not crop a multi-panel sheet: the stage page shows which picture will be the base, and a hint to put a full-length `full_body.png`. No picture of their own — that character is not run, the others still are. Do not mix in old pictures from subfolders.

## Shot contract

The stage folders and documents do not change:

```text
shots/{shotId}/characters/
  refs/  output/  approve/
  prompt.md  llm_notes.md  refs.md  workflow.md  status.json
```

`workflow.md` is an optional note for this shot. It can stay empty.

The approved file: `approve/{name}_{shotId}.png` (example: `lena_s01.png`). It is the character reference for `first_frame`, `video_preview` and `final_render`.

## What goes into refs/

| File | Role | From |
| --- | --- | --- |
| `{name}_base.*` | image 1, when the user placed the file | a base for this shot. Without it the library picture is used |
| `{name}_clothes.*` | image 2, when the user placed the file | without it, node «image 2: образец одежды» is bypassed. `{name}_outfit.png` does not enter the graph |
| `{name}_face.png` | the face for later stages | this graph does not use it |

One item — one reference. A layer that is not visible on the reference (a dress under a jacket) is made in a separate pass.

## Order

1. Take one full-length figure from `data/characters/{name}/` — image 1.
2. Outfit edit: image 2 is the garment reference; the text names the layer that changes and keeps the face, hair, pose, framing and background.
3. If the base's lower garment shows under the new clothes, replace it with the requested layer in a second pass. Write what is worn, not “without trousers”.
4. If the feet are missing because the frame is cropped, extend the same figure downward.
5. Each run lands in `output/`, and the file name starts with `{name}_{shotId}_v1`. Only the user puts a file in `approve/`. The agent sets `"status": "done"` when `prompt.md` is written. Do not touch `status.json`: the board sets the stage status.

Prompt: `playbooks/models/qwen_outfit.en.md`. Graph: `playbooks/workflows/characters_comfy.en.md`. Model parameters: `playbooks/models/qwen_image.en.md`.

## Checked (teaser s07)

- One character source per pass. Light background, full-length figure.
- A garment reference as a separate picture (image 2) carries colour, pattern and cut better than text. The text names details that must not be lost: neckline, waist tie, length, the layer under the dress.
- No negations in the positive prompt. Write only what must be there.
- Qwen guesses badly. Show everything that is not visible on the reference, or name it explicitly.
- The base's grey trousers under the sarafan went away in a second pass that described the skirt as a layer covering the legs. No “without trousers” ban was used.
- A frame cropped at the hips was extended downward by the same edit with a taller canvas.
- Fix the source, do not patch it with the prompt.

## Failed

Combining the pose from the shot and clothes from another picture in one pass: the model gets two signals about the clothes.

| Approach | Result | Reason |
| --- | --- | --- |
| image 1 = the needed pose, image 2 = the needed clothes, prompt “change clothes” | High heels; two jackets at once | Shoes on image 2 poorly visible; the flying jacket from image 1 leaks in |
| image 1 = the needed clothes, pose described in text | A cloak appeared that is not on image 1 | Text about a flying coat overrode the picture |
| The same without the cloak, ban via negative | Not confirmed | At cfg 1.0 the negative has no effect |

So here the character only changes clothes and stands. The shot's pose belongs to `first_frame`.

## Do not

- Do not feed as image 1 a picture where the person wears other clothes in the needed pose: the clothes leak in parts.
- Do not write negations in the positive prompt.
- Do not hope the model guesses the invisible: cropped shoes become high heels, a covered dress top becomes a random bodice.
- Do not feed two images of the same character in different poses: the model mixes poses and faces.

## Where to write the run result

The run summary goes to `run_log.md`. Do not touch `llm_notes.md`: the board clears it when the request is sent. Do not roll back settings that are already fixed because of a new shot.
