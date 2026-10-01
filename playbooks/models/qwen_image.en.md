# Model: Qwen Image Edit

English copy for the model. Russian original: `playbooks/models/qwen_image.md`.

Prompts for the shot character. Shot pose assembly is in `playbooks/stages/characters.en.md`. Graph: `playbooks/workflows/characters_comfy.en.md`.

Location prompts are in `playbooks/models/qwen_location.en.md`. First-frame prompts are in `playbooks/models/qwen_first_frame.en.md`.

## Parameters

Lightning 4-step LoRA is on, strength 1.0.

| Parameter | Value |
| --- | --- |
| Steps | 4 |
| CFG | 1.0 |
| Sampler / scheduler | euler / simple |
| Seed | random, 2–4 runs, keep the best |
| Shift (AuraFlow) | 3.1, as in the graph |
| CFGNorm | 1.0 |

At cfg 1.0 the negative does not affect the result. Extra clothes and heels are removed by clean inputs, not by a ban list. The negative node stays in the graph for cfg above 1. With the Lightning LoRA, raising cfg usually damages the image.

These parameters are for the pose assembly. The outfit edit is a different pass: 25 steps, cfg 1, euler / simple, LoRA `qwen2.1\lenovo_qwen21.safetensors` at strength 0.6. Filenames and the required `resolution_steps` field are in the Command section of `playbooks/workflows/characters_comfy.en.md`. Names inside the assembly JSON are not canonical: the bf16 UNET in that file is not on disk.

## Prompt structure

1. Image roles.
2. Pose and motion, short, as a hint to the skeleton.
3. Framing and light.

In the assembly prompt, do not describe appearance or clothing in text. The images set them. In the outfit-edit prompt, name only the layer that changes. The positive prompt has no negations. Write only what should be there.

For a man, change `woman` to `man`. If the face is not needed (seen from behind), remove the image 3 sentence and disconnect image3 on both encoders.

## Templates

The assembly text is locked on teaser s07. It does not name clothes. The sentence “wearing exactly the outfit” was not used: it describes clothes in text again.

Pose from a skeleton (only when the user explicitly asks for a specific pose from a reference; otherwise do not use this template):

```text
Image 1 is the woman with her complete outfit. Image 2 is a pose skeleton. Image 3 is her face.

The woman from image 1 takes the exact pose of the skeleton in image 2: standing straight, arms at her sides. Her face is the face from image 3.

Full body. Plain light grey studio background, soft even light. Photorealistic.
```

The outfit edit names only the layer that changes and keeps the rest. The text contains `<image1>`. Do not change the pose:

```text
Change the lower garment in <image1>. The green sarafan continues as one skirt from the shoulder straps down below the knees, over the yellow turtleneck. The same grey shoes stay fully visible. The necklace stays on the neck. Her face, pinned-up hair, standing pose, framing, lighting and plain light background stay exactly as in <image1>.
```

Extend a cropped frame downward. The canvas is taller than the source. It is the same figure:

```text
Extend <image1> downward into a full-length standing view. The head stays near the top of the frame. Both feet and plain flat shoes are fully visible at the bottom, with a margin of the plain light background under the shoes. Her face, hair, and standing pose stay as in <image1>. Plain light background.
```

If the skeleton lines are visible in the result, add: `Image 2 is only a pose guide.`

Removing an outer layer with one sentence has not been checked on a shot. The old example below is not a substitute for the edit in the Command section:

```text
The woman in image 1 now wears only the brown dress: the skirt part stays exactly the same, and the upper part continues in the same brown fabric — a simple fitted bodice, long sleeves, a round neckline. One continuous dress from shoulders to below the knees.

Her face, hair, pose, tights, boots, framing, lighting and plain white background stay exactly as in image 1.
```

Negative, only if the node accepts it and cfg is above 1. Words without “no”:

```text
cape, cloak, second jacket, extra layers, high heels, stilettos
```

## Do

- One outfit image per pass. Reference roles in the first sentence.
- Show anything invisible on the reference, or name it directly.
- Use a face crop when the figure is small.
- Fix conflicting inputs. Do not add bans.

## Don't

- Do not describe clothing and shoes in text when they should come from an image.
- Do not copy clothing details from the pose sample into the prompt.
- Do not write “do not do X” in the positive prompt. The model often does X.
- Do not mix two photos of the same person in different poses.
