# Model: FireRed location

English copy for the model. Russian original: `playbooks/models/firered_location.md`.

A new location from 1–3 pictures in `refs/`. Graph `playbooks/workflows/comfy/location_firered_edit.json`, manifest `location_firered` (stage `location`, menu item «Локация из референсов: FireRed»). When to pick it instead of `location_views` or `location_krea2`: `playbooks/stages/location.en.md`, section "Which graph".

## The model

FireRed-Image-Edit-1.1. In the user's graph: `FireRed-Image-Edit-1.1-transformer.safetensors`, Qwen2.5-VL 7B text encoder (`qwen_2.5_vl_7b_fp8_scaled.safetensors`), VAE `qwen_image_vae.safetensors`. The Lightning LoRA is on (`FireRed-Image-Edit-1.0-Lightning-8steps-v1.0.safetensors`): 8 steps, cfg 1. The canvas is empty, 9:16. The model sees the pictures through the encoder, not as an edit latent.

The model takes 1–3 pictures. The board does not send a fourth: the run fails, and the extra file is removed with «Убрать».

In the graph:

| Node | What | Who changes it |
| --- | --- | --- |
| `192:187` | prompt text | the board: the whole `prompt.md` |
| `143`, `144`, `145` | image 1, 2, 3 | the board: files in `refs/`, by name, at most three. No second or third file — that node is bypassed |
| `192:195` | 9:16 | the board |
| `192:189` | seed | the board, random. Do not change steps, cfg, or the Lightning switch |
| `9` | save | prefix `frameboard/location/{shotId}_firered` |

The negative prompt stays empty. Everything you need goes in the positive prompt.

## Prompt

A short instruction in English, one paragraph, no `##` headings. Do not retell the whole room. With Lightning at 8 steps an instruction holds better than a long description.

Picture order is the file-name order in `refs/`. The first name is image 1, the second is image 2, the third is image 3.

1. What stays: materials, objects, and light that are on the references.
2. What to build: a new location for the shot size. The user message about framing wins over the shot text.
3. One phrase for each picture's role. If image 2 or image 3 is not there, do not mention that number.
4. End with `Empty room, no people.`

Do not add people, houses, cars, signs, or furniture that are not on the references. Do not write file names.

```text
Build a new 9:16 view of the same room as image 1, eye level, medium shot. Keep the herringbone parquet and the faceted glass from image 1. Take the yellow lamp from image 2 and leave it out of frame, only its light on the wall. Empty room, no people.
```

One reference uses the same shape, without image 2 or image 3.
