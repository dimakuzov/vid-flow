# Workflow: video_preview (Comfy)

English copy for the model. Russian original: `playbooks/workflows/video_preview_comfy.md`.

Wan 2.2 turbo video sketch. The board runs the graph through the manifests `video_i2v` and `video_flf` (final: `final_i2v`, `final_flf`, the same graphs). The graphs stay as they are; nodes are not rewritten.

- First frame: `playbooks/workflows/comfy/wan22_i2v_sketch_turbo_api.json`
- First and last frame: `playbooks/workflows/comfy/wan22_flf_sketch_turbo_api.json`

Before queueing, only these change:

| Node | Field | Value |
| --- | --- | --- |
| LoadImage 97 | `image` | The file from `first_frame/approve/`, uploaded as `{shotId}_start.png` |
| LoadImage 98 | `image` | FLF only: the newest picture in this stage's `refs/`, as `{shotId}_end.png` |
| CLIPTextEncode 129:93 | `text` | `prompt.md` as is, nothing added |
| KSamplerAdvanced 129:86 | `noise_seed` | A new seed |
| PrimitiveFloat 129:161 | `value` | Seconds, when `prompt.md` has `N sec` (2–8). Otherwise 5 from the graph |
| SaveVideo 108 | `filename_prefix` | `frameboard/video/{shotId}_i2v` or `_flf`; final: `frameboard/final/...` |

Do not touch the negative 129:89, steps, CFG, LoRA, 384×672, or the turbo switches. Prompt: `playbooks/models/wan_video.en.md`.

## Models

| Node | File |
| --- | --- |
| UNETLoader 129:95 / 129:96 | `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` / `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors` |
| CLIPLoader 129:84 | `umt5_xxl_fp8_e4m3fn_scaled.safetensors`, type `wan` |
| VAELoader 129:90 | `wan_2.1_vae.safetensors` |
| LoRA 129:101 / 129:102 | `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors` / `..._low_noise.safetensors`, strength 1.0 |

All files are on the ComfyUI disk (checked against the `models/` folder).

## Metadata

`SaveVideo` (108) writes a `prompt` key into the mp4 container: the API-format graph with every value, including the text and the seed. The `workflow` key (the UI graph) appears only when the client sends `extra_data.extra_pnginfo`; the board sends only `prompt`, so it is absent. `prompt` is enough to repeat a run. No metadata is written when ComfyUI runs with `--disable-metadata`.
