# Workflow: characters (Comfy)

English copy for the model. Russian original: `playbooks/workflows/characters_comfy.md`.

Two passes. A Qwen Image 2.1 edit changes the clothes. `playbooks/workflows/comfy/character_pose_outfit_qwen.json` assembles the pose: image 1 = one figure in the shot outfit, image 2 = the skeleton, image 3 = the face. On teaser s07 this produced `approve/katya_s07.png` and `approve/lena_s07.png`.

Do not edit the graph JSON. Inject filenames, prompt text, and the seed into the queue. Do not run `update_comfyui.bat`. ComfyUI is at `http://127.0.0.1:8188`.

## Command

A Cursor agent and a Claude agent both follow this section when the shot stage is `characters`. Rewriting `prompt.md` is not the result. Keep going until every character in the shot has a matching `approve/{name}_{shotId}.png`.

One character per pass. Do not put character names in the generation text. Do not delete existing files in `output/` or `approve/`.

### Identity source

Look for `full_body.png`, `portrait.png`, and `side.png` in `data/characters/{Name}/`. If a canonical name is missing, use an existing png in that folder. Skip `_old/` and any file with `Copy` in the name. If the character has no picture, stop and name the missing file. Do not invent the person.

Do not crop a face out of a three-panel sheet, and do not use the sheet as the pose sample. The pose sample is the right panel: one full-body figure.

### Outfit edit

The canvas follows image 1: `ComfySwitchNode.switch` is false, and the latent comes from the encoder slot. Do not change steps, cfg, sampler, or LoRA.

| Node | Value |
| --- | --- |
| UNETLoader | `qwen_image_2.1_int8_convrot.safetensors`, weight_dtype `default` |
| CLIPLoader | `qwen3vl_8b_int8_convrot.safetensors`, type `qwen_image` |
| VAELoader | `qwen_image_2.1_vae_bf16.safetensors` |
| LoraLoaderModelOnly | `qwen2.1\lenovo_qwen21.safetensors`, strength 0.6 |
| QwenImage21Cache | device `auto`, dtype `default` |
| TextEncodeQwenImage21 | empty negative, resolution 1024, `images.image_1` is the source. The text contains `<image1>` |
| KSampler | 25, cfg 1, euler, simple, denoise 1 |

Save the result as `refs/{name}_outfit.png`: one figure, standing, light background, shoes fully visible, clothes not blowing.

If the base trousers still show under the new top, run a second edit on that same figure. Describe the requested lower garment and the same shoes. The edit that worked said the green sarafan continues as a skirt below the knees over the yellow turtleneck, and the grey shoes stay. It did not say “no trousers”.

If the feet are missing because the frame is cropped, use a taller canvas: `EmptyLatentImage`, both sides divisible by 32, switch true. The prompt extends the same figure downward: the head stays near the top, both feet and plain flat shoes are fully visible, and the clothes and hair already on the source stay. This is not a new person.

### Skeleton

`refs/{name}_pose.png` is that same single figure. DWPreprocessor: hand, body, and face = enable, resolution 1024, bbox `yolox_l.onnx`, pose `dw-ll_ucoco_384_bs5.torchscript.pt`, scale_stick disable.

The preview must show both arms, both hands, both legs, and both feet. If the feet are missing, go back to the extension step. Do not assemble.

### Assembly

Do not rewrite the graph file. Substitute the installed models in the API. The bf16 UNET name in the JSON is not on this machine.

| Node | Value |
| --- | --- |
| UNETLoader | `qwen_image_edit_2511_fp8mixed.safetensors`, weight_dtype `default` |
| CLIPLoader | `qwen_2.5_vl_7b_fp8_scaled.safetensors`, type `qwen_image`, device `default` |
| VAELoader | `qwen_image_vae.safetensors` |
| LoraLoaderModelOnly | `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors`, strength 1.0 |
| ModelSamplingAuraFlow | shift 3.1 |
| CFGNorm | 1.0 |
| ImageScaleToTotalPixels | lanczos, megapixels 1.0, `resolution_steps` 1 |
| VAEEncode | pixels of the scaled skeleton, not the outfit photo |
| KSampler | a numeric seed, 4 steps, cfg 1, euler, simple, denoise 1 |
| NEGATIVE | keep the graph text. At cfg 1 it has no effect |

`resolution_steps` is required by the installed node. Without it the queue returns 400 on the scale nodes. Do not send the string `randomize` to KSampler. That widget is UI-only.

image 1 = `refs/{name}_outfit.png`. image 2 = `refs/{name}_pose.png`. image 3 = `refs/{name}_face.png`.

The assembly prompt does not describe clothing or appearance. Template: `playbooks/models/qwen_image.en.md`. The pose sentence matches the skeleton, not the shot action, unless a pose plate for that action exists. Two runs, new seeds. Copy the best file to `output/`. Copy it to `approve/{name}_{shotId}.png` only when the layers, shoes, and hair match the outfit sheet.

Queue: `POST /upload/image`, `POST /prompt`, `GET /history/{prompt_id}`, `GET /view`. If the response has `node_errors`, record the node name and the text. Fill a missing field with that node's default. Do not change steps, cfg, sampler, or LoRA.

Set the stage `status.json` to `done` only when every character in the shot has an approve file. Append the run note to `run_log.md`. `llm_notes.md` is only the user's recommendation. Do not overwrite it with the log. The previous `prompt.md` stays in `prompt_history.json` when the prompt is replaced.

## If something is wrong

| Symptom | What to do |
| --- | --- |
| 400, `resolution_steps` missing on ImageScaleToTotalPixels | Set 1 and queue the same graph again |
| The skeleton has no feet | Extend the same frame downward. Do not assemble |
| Base trousers show under a sarafan or dress | Second edit: describe the skirt and the same shoes |
| The assembly shows several people or a grid | image 1 or image 2 was the contact sheet. Use one figure |
| Colored skeleton lines are visible | Add `Image 2 is only a pose guide.` |
| Extra clothing or heels | Fix the outfit sheet: shoes and every layer must be clearly visible |
| The face does not match | Use a portrait in the pose angle. Do not crop a face out of the sheet |
| The character stands like the outfit sheet and ignores the pose | On s07 the skeleton held in this graph. A different pose needs a new pose plate, not a paragraph about clothes |
