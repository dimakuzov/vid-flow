# Workflow: characters (Comfy)

English copy for the model. Russian original: `playbooks/workflows/characters_comfy.md`.

Graph: `playbooks/workflows/comfy/character_pose_outfit_qwen.json`.

It takes clothing from image 1, a pose skeleton from image 2, and a face from image 3. This is the hypothesis in `playbooks/stages/characters.en.md`. The graph has not been run on shots yet. Test it on 1–2 shots first.

Frameboard does not run it. Open the file in ComfyUI by hand.

## Where to look in the graph

| What | Node | Note |
| --- | --- | --- |
| Qwen Edit model | UNETLoader | The file name 2511 is a placeholder. Pick your 2.1 checkpoint |
| Text encoder | CLIPLoader, type `qwen_image` | `qwen_2.5_vl_7b_fp8_scaled` or the encoder from your 2.1 setup |
| VAE | VAELoader | `qwen_image_vae` |
| Lightning 4-step LoRA | LoraLoaderModelOnly | The build that matches your model, strength 1.0 |
| Skeleton | DWPreprocessor | Package `comfyui_controlnet_aux` via Manager. DWPose models download on first run |

ComfyUI is pinned at commit `097365b`. Do not run `update_comfyui.bat`. Install only the `controlnet_aux` node pack through Manager.

The graph uses the standard Qwen Image Edit nodes (`TextEncodeQwenImageEditPlus`, inputs image1–3). If your working Qwen 2.1 graph uses other loaders or another text-encoder node, replace them here and connect the same three images.

## Inputs

The outfit sheet decides quality more than anything else. The model invents whatever is not visible on it.

| Comfy input | Series file | Requirements |
| --- | --- | --- |
| 1. Outfit | `shots/{shotId}/characters/refs/{name}_outfit.png` | Full body, standing straight, light background, shoes and bag fully visible, clothes not blowing |
| 2. Pose sample | `shots/{shotId}/characters/refs/{name}_pose.png` | Every limb visible. Image aspect matches the output. Clothing is not taken from this image |
| 3. Face | Crop of `data/characters/{name}/portrait.png` or `side.png` | For a small figure, forehead to chin. Same angle as the pose |

An extra layer on the outfit sheet (a jacket that is not in the shot) is removed in a separate edit pass. Template: `playbooks/models/qwen_image.en.md`. The graph receives the corrected sheet.

## Run

1. Open the JSON and select your model, encoder, VAE, and Lightning LoRA files.
2. Load the three images into the nodes “1. ОБРАЗ”, “2. ОБРАЗЕЦ ПОЗЫ”, “3. ЛИЦО”.
3. The first run is only a skeleton check. The “Проверь скелет” preview must show both arms and both legs. Replace the pose sample if a limb is missing.
4. In the “PROMPT” node, change the short pose after the colon and the framing (`Full body`, `Waist-up`, `From behind`). Do not describe clothing or appearance. Do not write negations.
5. Leave KSampler alone: 4 steps, cfg 1.0, euler / simple, random seed. Run 2–4 times.
6. Compare with the outfit sheet: clothing layers, shoes, bag, face.
7. SaveImage writes to `ComfyUI/output/frameboard/`. Copy the best file to `shots/{shotId}/characters/output/`, then approve it as `approve/{name}_{shotId}.png`.

The NEGATIVE node has no effect at cfg 1.0.

## If something is wrong

| Symptom | What to do |
| --- | --- |
| DWPreprocessor is red or its fields are wrong | hand/body/face = enable, resolution 1024, bbox `yolox_l.onnx`, pose `dw-ll_ucoco_384_bs5.torchscript.pt` |
| Error on TextEncodeQwenImageEditPlus | This 2.1 build uses a different encoder node. Take it from a working graph and connect the same three images |
| The character stands like the outfit sheet and ignores the pose | The skeleton does not hold in edit mode. Feed the same skeleton as control_image in a Qwen 2.1 Fun ControlNet graph. That graph is not in this repo yet |
| Colored skeleton lines are visible | Add `Image 2 is only a pose guide.` to the prompt |
| Extra clothing or heels | Fix the outfit sheet: shoes and every layer must be clearly visible |
| The face does not match | Use a portrait in the pose angle (`side.png` for a profile) or a tight face crop |
| The face is not needed (from behind) | Disconnect image3 on both encoders and remove the image 3 sentence |

Write the test result in the shot’s `llm_notes.md`. Anything confirmed on 2–3 shots moves to “Verified” in `playbooks/stages/characters.en.md`.
