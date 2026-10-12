# Workflow: characters (Comfy)

English copy for the agent. Russian original: `playbooks/workflows/characters_comfy.md`.

A shot character is a Qwen Image 2.1 outfit edit. Graph: `playbooks/workflows/comfy/character_outfit_qwen21.json` (API format). It made `approve/katya_s07.png` and `approve/lena_s07.png` on teaser s07.

Do not edit the graph JSON: the queue gets the image names, the text, the seed and the prefix. Do not run `update_comfyui.bat`. ComfyUI: `http://127.0.0.1:8188/`.

## Graph

| Node | What | Value |
| --- | --- | --- |
| 10 LoadImage | image 1 — the character | the base from `data/characters/{name}/` or the result of a previous pass |
| 22 LoadImage | image 2 — the garment reference | `refs/{name}_clothes.*`. No file — the node is bypassed |
| 11 UNETLoader | model | `qwen_image_2.1_int8_convrot.safetensors`, weight_dtype `default` |
| 12 CLIPLoader | encoder | `qwen3vl_8b_int8_convrot.safetensors`, type `qwen_image` |
| 13 VAELoader | VAE | `qwen_image_2.1_vae_bf16.safetensors` |
| 14 LoraLoaderModelOnly | LoRA | `qwen2.1\lenovo_qwen21.safetensors`, strength 0.6 |
| 15 QwenImage21Cache | cache | device `auto`, dtype `default` |
| 16 PrimitiveStringMultiline | text | template in `playbooks/models/qwen_image.en.md` |
| 17 TextEncodeQwenImage21 | encoder | empty negative, resolution 1024, `images.image_1` = node 10, `images.image_2` = node 22. The latent comes from the encoder slot: canvas as image 1 |
| 19 KSampler | sampler | seed as a number, 25 steps, cfg 1, euler, simple, denoise 1 |
| 21 SaveImage | file | `filename_prefix` such as `frameboard/{shotId}/{name}_dress` |

Do not change steps, cfg, sampler or LoRA.

No garment reference — node 22 («image 2: образец одежды») is bypassed: node 22 and the `images.image_2` key on node 17 leave the prompt. Do not mention image 2 in the text. Other files in `refs/` do not enter the graph.

## Command

The agent runs this section when the shot stage is `characters`. Paperwork in `prompt.md` is not enough: keep running until every character in the shot has a suitable `approve/{name}_{shotId}.png`.

One character per pass. Do not write character names in the generation text. Do not delete old files in `output/` and `approve/`.

### Base

Look for `full_body.png`, `portrait.png`, `side.png` in `data/characters/{Name}/`. Image 1 must be one full-length figure, standing straight, light background. If there is no such file, take an existing png of that folder, but not a whole three-panel sheet (the right panel, one figure). Do not take `_old/` or files with `Copy` in the name. No picture of their own — stop and write the name of the missing file; do not invent a person.

### Outfit edit

Image 1 is the character, image 2 is the garment reference from `refs/`. The text names only the layer that changes and keeps the face, hair, pose, framing, light and background (template in `playbooks/models/qwen_image.en.md`).

The result is one figure, standing, light background, shoes fully visible, clothes not flying.

If the base's lower garment shows under the new top, a second pass takes the first result as image 1 and describes the needed lower layer and the same shoes. An example that worked: the green sarafan continues as a skirt below the knees over the yellow turtleneck, the grey shoes stay. No “without trousers” phrase.

If the feet are missing because of cropping, make the canvas taller than the source: `EmptyLatentImage`, sides divisible by 32, instead of the encoder latent. The prompt extends the same figure downward: the head near the top edge, both feet and plain flat shoes fully visible, the clothes already on and the hair stay. It is not a new person.

Copy the finished file to `output/`. Put it into `approve/{name}_{shotId}.png` when the layers, shoes and hair match the request.

### Queue

Only `http://127.0.0.1:8188/`: `POST /upload/image`, `POST /prompt`, `GET /history/{prompt_id}`, `GET /view`. If this shell cannot open that address, still queue from here: write `data/comfy_queue/<id>.json` with status `pending`. The board on the ComfyUI computer sends it and writes `status`, `files` and `error` back into the same file. Wait for `done` or `error`.

```json
{
  "id": "s07-katya-1",
  "status": "pending",
  "prompt": { "10": { "class_type": "LoadImage", "inputs": { "image": "s07_katya_src.png" } } },
  "uploads": [{ "path": "data/characters/katya/full_body.png", "filename": "s07_katya_src.png" }],
  "saveTo": "data/episodes/teaser/shots/s07/characters/output"
}
```

`prompt` is the whole graph in API format (node number, `class_type`, `inputs`), like `character_outfit_qwen21.json`. The image name in `inputs` equals `filename` in `uploads`. `saveTo` only inside `data/`.

If the answer has `node_errors`, write down the node and the text. Fill a missing field with that node's default. Do not change steps, cfg, sampler or LoRA.

Set `"status": "done"` in `agent_request.json` when every character in the shot has an approve file. Do not touch `status.json`: the board sets the stage status. Append the run summary to `run_log.md`. Do not touch `llm_notes.md`. Before `prompt.md` is replaced, the previous text stays in `prompt_history.json`.

## If something is wrong

| Symptom | What to do |
| --- | --- |
| The base's trousers show under the sarafan or dress | Second pass: describe the skirt as a layer that covers the legs, and the same shoes |
| No feet, the frame is cropped | Extend the same figure downward, taller canvas |
| Extra clothes or high heels | Fix the inputs: shoes and every layer must be clearly visible on image 1 and image 2 |
| The garment from image 2 came over only partly | Name the missing details in the text: colour, pattern, neckline, length |
| The face, hairstyle or pose changed | Check that the text keeps them “exactly as in <image1>” and that image 1 is one figure |
