# Stage: characters

English copy for the model. Russian original: `playbooks/stages/characters.md`.

Shot-specific character: the outfit and pose of this shot. Face and body come from the base asset, not from the prompt text.

The “outfit + pose skeleton + face” assembly is a **hypothesis**. It is not confirmed on 2–3 shots yet. Rules marked “verified” already work. Do not break them.

## Depends on the identity library

The character canon lives outside the shot:

```text
data/series/characters/{name}/
  portrait.png     # front face (source notes: portret.png)
  side.png         # profile face (portret_side.png)
  full_body.png    # full body, light background
```

The shot variant is built from that library into `shots/{shotId}/characters/`. Do not mix old pictures from subfolders into the pass. One character, one outfit image per pass.

`portrait` / `side` are only the “face” role, in the same angle as the pose. If the figure is small in frame, put a tight crop in `refs/`: forehead to chin, as little hair as possible.

## Shot contract

Stage folders and documents stay as they are:

```text
shots/{shotId}/characters/
  refs/  output/  approve/
  prompt.md  llm_notes.md  refs.md  workflow.md  status.json
```

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

1. Take one source image from `data/series/characters/{name}/`.
2. Build the shot outfit sheet and fix hidden parts in a separate edit pass.
3. Extract a skeleton from `{name}_pose.png` (DWPose). The skeleton has no clothes and no face, so nothing can leak from the pose image.
4. Assemble with `playbooks/workflows/comfy/character_pose_outfit_qwen.json`. Hypothesis: image 1 = outfit, image 2 = skeleton, image 3 = face.
5. Compare the result to the outfit sheet: the same number of clothing layers, the same shoes, the same bag, a similar face. Fix the error in the source image, not with a ban in the prompt.
6. Best frames go to `output/`. The chosen file goes to `approve/{name}_{shotId}.png`.

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

## Failed

Combining a pose from one frame and clothing from another image in a single pass. The model receives two signals about clothing.

| Approach | Result | Cause |
| --- | --- | --- |
| image 1 = desired pose, image 2 = desired outfit, prompt “change the clothes” | High heels; two jackets at once | Shoes on image 2 are hard to see; a blowing jacket on image 1 leaks through |
| image 1 = desired outfit, pose written out from a sample image | A cloak appeared that is not on image 1 | A phrase about a blowing coat overrode the image |
| Same, without the cloak, banned in the negative | Not confirmed | At cfg 1.0 the negative has no effect |

Removing an outer layer with a prompt (“jacket + skirt → one dress”, with an explicit description of the hidden bodice) is also not confirmed.

## Hypothesis

Clothing comes only from the outfit sheet. Pose comes from a skeleton, with no clothing and no face. Qwen Image Edit from 2509 is described as understanding keypoint maps; for Qwen 2.1 this still has to be tested.

If the skeleton does not hold in a normal edit, feed the same skeleton as `control_image` in a Qwen 2.1 Fun ControlNet graph. That graph does not exist here yet.

Prompt templates are in the model playbook. The template texts are also a hypothesis: they follow the verified rules, but they are not locked in on real shots.

## Do not

- Do not use a pose reference as a clothing source. Clothing leaks from it in pieces.
- Do not describe, in text, the clothing on the pose sample.
- Do not write negations in the positive prompt.
- Do not expect the model to guess what is hidden: cropped shoes become heels, a covered dress top becomes a random bodice.
- Do not solve pose, clothing, and face with one sentence. Each image has one role.
- Do not feed two images of the same character in different poses. The model mixes poses and faces.

## Where to write the test result

In this shot’s `llm_notes.md`: what worked and what broke. If the hypothesis holds on 2–3 shots, move it to “Verified” in this playbook.
