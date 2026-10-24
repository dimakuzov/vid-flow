# Model: Qwen Image 2.1 Edit (character)

Prompts for the shot character: the outfit edit. Stage rules: `playbooks/stages/characters.en.md`. Graph and run: `playbooks/workflows/characters_comfy.en.md`.

Location prompts: `playbooks/models/qwen_location.en.md`. First-frame prompt: `playbooks/models/qwen_first_frame.en.md`.

## Parameters

As in the `character_outfit_qwen21.json` graph, do not change:

| Parameter | Value |
| --- | --- |
| Model | `qwen_image_2.1_int8_convrot.safetensors` + LoRA `qwen2.1\lenovo_qwen21.safetensors`, strength 0.6 |
| Steps | 25 |
| CFG | 1.0 |
| Sampler / scheduler | euler / simple |
| Seed | random, 2–4 runs, take the best |
| Encoder resolution | 1024, canvas as image 1 |

At cfg 1.0 the negative has no effect. Extra clothes and high heels are removed with clean inputs, not with a list of bans.

## Prompt structure

1. Image roles: `Image 1 is the standing girl. Image 2 is the green dress to copy.`
2. What changes in `<image1>` and how it looks: colour, pattern, cut, length, the layer underneath.
3. What stays: shoes, face, hair, pose, framing, light, background — `exactly as in <image1>`.

Name only the layer that changes. No negations in the positive prompt: write what must be there. For a male character change `girl` to `man`. Without a garment reference drop the image 2 sentence and describe the clothes fully.

## Templates

Outfit edit from a reference (teaser s07, Katya, accepted):

```text
Image 1 is the standing girl. Image 2 is the green dress to copy. Change the outer green garment in <image1> so it matches the dress in <image2>: dark green, small gold teardrop motifs, a halter neckline, a fitted bodice, a tie at the waist, and a tiered skirt below the knees. The yellow turtleneck underneath is fitted and matte, with long sleeves and the collar visible. A large pearl necklace sits on the neck over the turtleneck collar, and each bead is big and white. The same grey shoes stay fully visible. Her face, pinned-up hair, standing pose, framing, lighting and plain light background stay exactly as in <image1>.
```

Replacing the lower layer in a second pass (image 1 is the first pass result):

```text
Change the lower garment in <image1>. The green sarafan continues as one skirt from the shoulder straps down below the knees, over the yellow turtleneck. The same grey shoes stay fully visible. The necklace stays on the neck. Her face, pinned-up hair, standing pose, framing, lighting and plain light background stay exactly as in <image1>.
```

Extending a cropped frame downward. Canvas taller than the source, the same figure:

```text
Extend <image1> downward into a full-length standing view. The head stays near the top of the frame. Both feet and plain flat shoes are fully visible at the bottom, with a margin of the plain light background under the shoes. Her face, hair, and standing pose stay as in <image1>. Plain light background.
```

## Do

- One character per pass. Image roles in the first sentence.
- Name in text the details of the reference that must not be lost: neckline, waist tie, length, the layer under the dress, jewellery.
- Show everything that is not visible on the reference, or name it explicitly.
- Fix contradicting inputs instead of adding bans.

## Don't

- Do not write “do not do X” in the positive prompt: the model often does X.
- Do not re-describe what must stay: only “stays exactly as in <image1>”.
- Do not mix two photos of the same person in different poses.
