# Model: Qwen Image Edit

English copy for the model. Russian original: `playbooks/models/qwen_image.md`.

Prompts for the shot character and the first frame. Shot pose assembly is in `playbooks/stages/characters.en.md`. Graph: `playbooks/workflows/characters_comfy.en.md`.

Location prompts are in `playbooks/models/qwen_location.en.md`.

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

Loaders in the graph are placeholders for Qwen 2.1: UNET, CLIP (`type: qwen_image`), VAE `qwen_image_vae`, and the Lightning LoRA that matches the checkpoint. Filenames inside the JSON are not canonical.

## Prompt structure

1. Image roles.
2. Pose and motion, short, as a hint to the skeleton.
3. Framing and light.

Do not describe appearance or clothing in text. The images set them. The positive prompt has no negations. Write only what should be there.

For a man, change `woman` to `man`. If the face is not needed (seen from behind), remove the image 3 sentence and disconnect image3 on both encoders.

## Templates

The texts follow the verified rules. The texts themselves are still a hypothesis.

Pose from a skeleton (assembly step):

```text
Image 1 is the woman with her complete outfit. Image 2 is a pose skeleton. Image 3 is her face.

The woman from image 1, wearing exactly the outfit from image 1 with every garment, the shoes and the bag, takes the exact pose of the skeleton in image 2: [short pose, for example: running fast to the right, side profile, mid-stride]. Her face is the face from image 3.

[Full body / Waist-up / From behind]. Plain light grey studio background, soft even light. Photorealistic.
```

If the skeleton lines are visible in the result, add: `Image 2 is only a pose guide.`

Outfit-sheet fix, remove an outer layer (example: a jacket over a dress). Do not change the pose on this step. Describe the hidden part explicitly:

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
