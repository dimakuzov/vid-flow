# Model: MiniMax Video

English copy for the model. Russian original: `playbooks/models/minimax_video.md`.

Status: **not connected to the board**. There is no graph and no manifest; no shot of this project has gone through MiniMax on the board. There is no `prompt.md` template yet: it is written after the first checked shot.

## Where it is used

Only for shots Wan 2.2 could not do after two or three rounds (`playbooks/models/wan_video.en.md`, section 5): EP.1 S4, S5, S16, S19 went to MiniMax or Seedance. MiniMax is not used for sketches.

## What is installed in ComfyUI

Checked against the `models/` folders (not run):

| Type | Files |
| --- | --- |
| Diffusion | `minimax_h3_fl2va_pruned_bf16`, `minimax_h3_fl2va_pruned_int8_convrot` (first + last frame), `minimax_h3_ref2va_*` (by references) |
| Text encoder | `qwen3vl_32b_minimax_h3_int8_convrot`, `qwen3vl_32b_minimax_h3_nvfp4_awq` |
| VAE | `minimax_h3_video_vae_fp16`, `minimax_h3_video_vae_int8_convrot`, `minimax_h3_audio_vae_fp32` |
| LoRA | `minimax_h3_fl2va_4step_lora`, `minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16`, `minimax/minimax_h3_turbo_4step_pruned_comfyui` |

## To connect it

1. Build a first-last (fl2va) graph in ComfyUI with the 4-step turbo LoRA, check it on one shot from the list above.
2. Save it in API format as `playbooks/workflows/comfy/minimax_h3_flf_api.json`, write a manifest (`final_minimax_flf`, stage `final_render`, order 40; inputs as in `final_flf`).
3. Check that the save node writes metadata (`prompt` in the container).
4. Add here: what worked in the prompt, duration, resolution, and a `prompt.md` template following `wan_video.en.md`, section 8. Update the Russian file in the same commit.
