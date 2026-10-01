# Stage: characters

English copy for the model. Russian original: `playbooks/stages/characters.md`.

Shot-specific character: the outfit and pose of this shot. Face and body come from the base asset, not from the prompt text.

Assembly of one figure in the shot outfit, a skeleton with every limb, and a face is verified on teaser s07. The next run is done by the agent, using the Command section in `playbooks/workflows/characters_comfy.en.md`. Do not break the rules below.

## Depends on the identity library

The character canon lives outside the shot:

```text
data/characters/{name}/
  portrait.png     # front face (source notes: portret.png)
  side.png         # profile face (portret_side.png)
  full_body.png    # full body, light background
```

The shot variant is built from that library into `data/episodes/{episodeId}/shots/{shotId}/characters/`. If a canonical name is missing, use an existing png in that character folder: the sheet, or `body.png` / `portret.png`. Skip `_old/` and files with `Copy` in the name. Do not invent a person who has no picture. Do not mix old pictures from subfolders into the pass.

Do not crop a face out of a three-panel sheet, and do not use that sheet as the pose sample. DWPose will see several bodies. The pose sample is one full-body figure, the right panel. Assembly image 1 is also one figure, already wearing the shot outfit.

`portrait` / `side` are only the “face” role, in the same angle as the pose. If the figure is small in frame, put a tight crop in `refs/`: forehead to chin, as little hair as possible.

## Shot contract

Stage folders and documents stay as they are:

```text
shots/{shotId}/characters/
  refs/  output/  approve/
  prompt.md  llm_notes.md  refs.md  workflow.md  status.json
```

`workflow.md` is an optional note for this shot. It can stay empty.

Approved file: `approve/{name}_{shotId}.png` (example: `lena_s01.png`).

That file is the character reference for `video_preview` and `final_render`. There is no `env/` folder in the series.

## What goes in refs/

| File | Role | Source |
| --- | --- | --- |
| `{name}_outfit.png` | Outfit sheet | An edit of `full_body.png` when the shot outfit differs from the base |
| `{name}_pose.png` | Pose only | Any frame where every limb is visible. Aspect ratio matches the output |
| `{name}_face.png` | Face | `portrait.png` or `side.png`; a tight crop when the figure is small |

Outfit sheet: full body, standing straight, light background, shoes and bag fully visible, clothes not blowing. If the shot needs a garment that is hidden on the sheet (a dress under a jacket), fix the sheet itself in a separate edit pass first. Do not change the pose on that pass.

No more than two characters per pass, or the surroundings drift.

## Order

1. Take one source image from `data/characters/{name}/`.
2. Make the shot outfit in a separate Qwen Image 2.1 edit. The pose graph does not change clothes. Do not change the pose on that pass.
3. If the base lower garment still shows under the new clothes, replace it in a second edit. Write what is worn. Do not write “no trousers”.
4. If the feet are missing because the frame is cropped, extend the same figure downward before the skeleton. Do not assemble without both feet.
5. Extract the skeleton from `{name}_pose.png`. The preview shows both arms, both hands, both legs, and both feet.
6. Assemble with `playbooks/workflows/comfy/character_pose_outfit_qwen.json`: image 1 = one outfit figure, image 2 = skeleton, image 3 = face.
7. Compare the result to the outfit sheet: the same layers, the same shoes, the same hair, a similar face. Fix the error in the source image, not with a ban in the prompt.
8. Best frames go to `output/`. The chosen file goes to `approve/{name}_{shotId}.png`. Set `status.json` to `done` only when every character in the shot has that file.

Prompt and parameters: `playbooks/models/qwen_image.en.md`. How to run the graph: `playbooks/workflows/characters_comfy.en.md`.

## Verified

- One character source per pass. Light background, framing matches the shot.
- Lightning 4-step LoRA is on in Qwen Image Edit.
- Reference roles come first in the prompt, then only where and how the character stands or moves. Do not describe appearance or clothing in text.
- No negations in the positive prompt. Write only what should be there.
- Qwen does not invent hidden detail well. Anything not visible on the reference must be shown in an image or stated explicitly.
- No more than two characters per pass.
- A separate face crop when the figure is small.
- Fix the source image. Do not patch the prompt.
- The shot outfit is stored as its own approved file and is the reference for video and the final render.
- On teaser s07 the assembly kept the pose, the face, and the layers when image 1 was one figure after the edit and the skeleton showed both feet.
- The base grey trousers under the sarafan went away in a second edit that described the skirt covering the legs. The ban “no trousers” was not used.
- A frame cropped at the hips was extended downward with the same edit and a taller canvas. The skeleton then showed both feet.

## Failed

Combining a pose from one frame and clothing from another image in a single pass. The model receives two signals about clothing.

| Approach | Result | Cause |
| --- | --- | --- |
| image 1 = desired pose, image 2 = desired outfit, prompt “change the clothes” | High heels; two jackets at once | Shoes on image 2 are hard to see; a blowing jacket on image 1 leaks through |
| image 1 = desired outfit, pose written out from a sample image | A cloak appeared that is not on image 1 | A phrase about a blowing coat overrode the image |
| Same, without the cloak, banned in the negative | Not confirmed | At cfg 1.0 the negative has no effect |

Removing visible base trousers by writing “no trousers” in the assembly prompt does not work. The assembly pass does not change clothes. A separate edit that describes the skirt worked on teaser s07.

## Locked by the run

Clothing comes only from the outfit sheet. Pose comes from a skeleton, with no clothing and no face. On teaser s07 the skeleton held in `character_pose_outfit_qwen.json` at 4 steps and cfg 1. ControlNet was not needed.

Prompt templates are in the model playbook. The assembly text does not name clothes. The outfit-edit text names only the layer that changes, and it keeps the face, hair, pose, and shoes.

## Do not

- Do not use a pose reference as a clothing source. Clothing leaks from it in pieces.
- Do not describe, in text, the clothing on the pose sample.
- Do not write negations in the positive prompt.
- Do not expect the model to guess what is hidden: cropped shoes become heels, a covered dress top becomes a random bodice.
- Do not solve pose, clothing, and face with one sentence. Each image has one role.
- Do not feed two images of the same character in different poses. The model mixes poses and faces.

## Where to write the test result

Write the run result in `run_log.md`. Leave `llm_notes.md` as the user's recommendation for the current prompt. Do not roll back settings that are already locked because a new shot is different.
