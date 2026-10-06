# Workflow: location (Comfy)

English copy for the model. Russian original: `playbooks/workflows/location_comfy.md`.

Graph: `playbooks/workflows/comfy/location_views_multiple_angles.json`. It is ComfyUI API format. Drag the file into the ComfyUI window.

Pass A takes `data/locations/{locationId}/view.png` and makes four vertical 9:16 views for one shot. Prompt text: `playbooks/models/qwen_location.en.md`.

Frameboard does not run the graph.

The four prompt strings inside the JSON are a bedroom example. Replace them with this shot's text before the run.

## Models

Every node is built in.

| Type | File | ComfyUI folder |
| --- | --- | --- |
| Diffusion | `qwen_image_edit_2509_fp8_e4m3fn.safetensors` | `models/diffusion_models` |
| Text encoder | `qwen_2.5_vl_7b_fp8_scaled.safetensors` | `models/text_encoders` |
| VAE | `qwen_image_vae.safetensors` | `models/vae` |
| LoRA | `Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors` | `models/loras` |
| LoRA | `Qwen-Edit-2509-Multiple-angles.safetensors` | `models/loras` |

Both LoRAs stay at strength 1.0.

## How the graph is built

The location image goes into the text encoder as a reference, not as the latent. The latent is empty, 768×1344, so the output is always 9:16. If you connect a VAE Encode of the picture, the frame takes that picture's aspect ratio.

Four independent branches. Each has its own prompt and seed. One run makes four variants.

Model chain: UNET → Lightning 4 steps → Multiple-angles → ModelSamplingAuraFlow (shift 3) → CFGNorm.

## What to change

| Node | What to set |
| --- | --- |
| Load Location Image | This location's `view.png`. The file must be in ComfyUI `input`, or picked in the node |
| Prompt v1 simple | Shot size and where we look. `Same room, no people.` |
| Prompt v2 objects | The frame through objects on the picture and in `description.txt`. `No people.` |
| Prompt v3 camera | One or two camera commands. `Keep the same room and lighting, no people.` |
| Prompt v4 camera + objects | Prompt v3, then `In frame:`, then prompt v2 |
| Save v1…v4 | The prefix is already `frameboard/location/v1_simple` and the matching names for the other branches. Add the shot id if you want |

Camera vocabulary for v3 and v4: `Rotate the camera 45/90/180 degrees to the left/right.` `Move the camera forward/back/down/up.` `Turn the camera to a close-up / wide-angle lens / top-down view / low-angle view / aerial view.`

The branches use different seeds. New variants of the same prompts need another seed or `randomize`.

## What to leave alone

- The models and both LoRAs, strength 1.0.
- KSampler: 4 steps, cfg 1, euler / simple, denoise 1.
- ModelSamplingAuraFlow shift 3, CFGNorm 1.
- Scale Image to Total Pixels: 1 MP.
- The empty negative prompt.

## After generation

1. Files appear in `ComfyUI/output/frameboard/location/`.
2. Copy the four variants to `shots/{shotId}/location/output/` as `{shotId}_v1_simple.png` … `{shotId}_v4_camera_objects.png`.
3. Write the four prompts into this stage's `prompt.md`, so the winning branch stays visible.
4. Put the best file in `approve/{locationId}_{shotId}.png`.
5. Light, an extra object, and cleanup are a separate Qwen Image 2.1 pass. Do not regenerate them here.

## If something is wrong

| Symptom | What to do |
| --- | --- |
| The frame is not 9:16 | `latent_image` on KSampler comes from Empty Latent 768×1344, not from VAE Encode |
| The camera barely moved | One command, not three. A large turn starts from an in-between view, or uses the two-reference pass in the model playbook |
| People appeared | Add `no people` to all four prompts. If the source has people, remove them in a separate edit first |
| No background blur | The model almost never paints it. Leave the background sharp |
| The light changed | Fix the light later in a separate pass, not in this graph |
