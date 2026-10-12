# Workflow: first_frame (Comfy)

English copy for the model. Russian original: `playbooks/workflows/first_frame_comfy.md`.

Graph: `playbooks/workflows/comfy/qwen21_character_compositing.json`. It is Qwen Image 2.1 Edit in ComfyUI API format.

Write the prompt from `playbooks/models/qwen_first_frame.en.md`. Frameboard does not run the graph.

The prompt inside the JSON is a template with placeholders. Replace it with this shot's text before the run.

## Models

| Node | File |
| --- | --- |
| Load Diffusion Model | `qwen_image_2.1_int8_convrot.safetensors` |
| Load CLIP | `qwen3vl_8b_int8_convrot.safetensors`, type `qwen_image` |
| Load VAE | `qwen_image_2.1_vae_bf16.safetensors` |
| Load LoRA | `qwen2.1\lenovo_qwen21.safetensors`, strength 0.6 |

The graph needs `ResolutionSelector`, `SaveImageAdvanced`, `ComfySwitchNode`, `QwenImage21Cache`, and `TextEncodeQwenImage21`. Those nodes were already installed in the working ComfyUI.

## Inputs

Put the pictures in `ComfyUI/input` and type their names into Load Image.

| Node | What to feed |
| --- | --- |
| Image 1 (location), id 470 | The shot's approved location, `shots/{shotId}/location/approve/`. For an edit, the chosen first frame itself |
| Image 2…6 (reference 1…5), id 902…906 | The references in a row: first `shots/{shotId}/characters/approve/{name}_{shotId}.png` of every character, then their portraits. Empty nodes are deleted together with `images.image_N` on node 488 |

The prompt calls the connected pictures `image 1`, `image 2`, … in the order of the inputs. The board fills `image_2`…`image_6` in a row, with no gaps (manifest `first_frame_compositing.bind.json`): with one character and a portrait, the portrait is image 3; with two, image 4 and image 5.

The pose and the direction on the reference should be close to the shot. The model takes the running direction from the picture. If the reference contradicts the shot, change the file or write `unlike image 2`.

## What to change

| Node | Field | What to set |
| --- | --- | --- |
| Positive Prompt (477) | `value` | This shot's prompt |
| KSampler (485) | `seed` | A new random seed for each variant |
| Save Image (Advanced) (461) | `filename_prefix` | Already `frameboard/first_frame/ff_v1`. Change the suffix for the next variant |
| Resolution Selector (13) | `aspect_ratio` | Leave `9:16 (Portrait Widescreen)`, 2.3 MP |

Leave these alone: 25 steps, cfg 1, euler / simple, LoRA 0.6, resolution 1024 on the text encoder, `switch = true`. The frame is built in an empty latent of the right size, not on top of image 1's latent.

## How to open it

An API-format file can open without a node layout. Then take the working Qwen Image 2.1 edit graph, add two Load Image nodes, and connect them to Text Encode Qwen Image 2.1 on `image_2` and `image_3`.

Through the API, the same JSON goes to `POST http://127.0.0.1:8188/prompt` as `{"prompt": <file contents>}`. Change the prompt, seed, and prefix before each send. Frameboard does not make that request.

## Order

1. Assembly. Image 1 is the clean location. 2–5 seeds. For two people and for direction, 5–10.
2. If place, size, pose, or direction is wrong, edit the prompt and assemble again.
3. A small edit: image 1 is the chosen frame, prompt `Edit image 1: <one change>. Keep EVERYTHING else exactly the same`. The second input can be the character reference or a frame with the light you want.
4. No more than one or two edits in a row.
5. Copy variants to `shots/{shotId}/first_frame/output/` as `{shotId}_ff_v1.png` and so on. The round prompt goes in `prompt.md`. The chosen file is `approve/{shotId}_first.png`.

## If something is wrong

| Problem | What to do |
| --- | --- |
| The character is brighter than the room | `No special lighting on her: she is lit by the same light as everything in image 1`, and if needed `slightly underexposed like everything around`. Do not name a colour of your own |
| The wrong surface | Describe the spot by colour, neighbouring objects, and part of the frame |
| Too large | Tie height to an object in the location |
| A medium shot comes out full height | Describe where the frame cuts the body (`the bottom edge of the frame cuts her at the waist`), not a fraction of the frame and not `stands on the floor` |
| A close-up comes out as a wide shot | Put the person right at the camera: `She stands right in front of the camera, very close: her face and shoulders fill most of the frame`. Do not «move the room closer»; if it still fails, ask the location stage for a closer view |
| The location changed: objects moved, added or gone, other buildings, other light | The lock from the model playbook («Lock»), naming what changed. Remove from the prompt any description of the place, your own light, weather and camera angle |
| Clothes or the bag differ from the reference | Remove the clothes and items description from the prompt, keep `Her clothes, shoes, bag … exactly as in image 2, unchanged` |
| The face drifts | Add a portrait (`refs/{name}_face.png` or in the library) and write `Her face exactly as in image N` |
| Two people swap places or roles | Name and number both in the first sentence, numbers from «Images the graph receives» |
| Location objects disappear | Name them, with `same places, sharp` |
| The background is soft | Assemble again from the clean location |
| Looking into the camera | Write where they look, and `NOT at the camera` |
