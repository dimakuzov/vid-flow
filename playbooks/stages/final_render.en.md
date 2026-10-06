# Stage: final_render

English copy for the model. Russian original: `playbooks/stages/final_render.md`.

## Decision: the final is the preview for now

There is no separate final graph. The final is made with the same Wan 2.2 turbo as the sketch, with the same settings:

| What | Value |
| --- | --- |
| Model | Wan 2.2 i2v 14B fp8, LoRA lightx2v 4 steps, CFG 1 (as `video_preview`) |
| Resolution | 384×672, 16 fps |
| Upscale | none, not done on the board |
| Frame interpolation | none, not done on the board |
| Files | `frameboard/final/{shotId}_i2v` or `_flf` in ComfyUI, a copy in this stage's `output/` |

Why: Wan full mode (20 steps, CFG 3.5) came out worse than turbo on the EP.1 sketches (`playbooks/models/wan_video.en.md`, section 6), and upscale and interpolation have not been checked on a single shot. An unchecked graph must not be presented as the final.

What the stage does now: a good sketch is repeated with the same `prompt.md` on new seeds (3–5), and the best variant is approved in `approve/`. That is the shot video for the edit. Upscaling to 1080×1920 and interpolating 16 → 32 fps is done by the user outside the board until a checked graph exists.

## Variants

| Manifest id | order | Graph | When |
| --- | --- | --- | --- |
| `final_i2v` | 10 | `wan22_i2v_sketch_turbo_api.json` | the approved sketch was i2v |
| `final_flf` | 20 | `wan22_flf_sketch_turbo_api.json` | the approved sketch was FLF. The last frame goes in this stage's `refs/` (a copy from `video_preview/refs/`) |

The rule is simple: the final repeats the variant of the approved sketch. The prompt is a copy of `video_preview/prompt.md`, template in `playbooks/models/wan_video.en.md`, section 8. Changing the text in the final means making a new sketch; go back to `video_preview` instead.

An agent may suggest the other variant through `suggestedWorkflow` (`final_flf` / `final_i2v`) when the video in `video_preview/approve/` is of the other variant (`_flf` / `_i2v` in the name).

## Candidates for a real final (not checked)

Already installed on the ComfyUI machine. Each item is its own graph + manifest in `playbooks/workflows/comfy/`, after a check on one shot:

1. **Video upscale**: SeedVR2 (`custom_nodes/seedvr2_videoupscaler`, models `seedvr2_3b_fp16`, `seedvr2_7b_int8_convrot`). Input: the approved preview video, output 1080×1920. Manifest: `final_upscale`, order 30, input `approve:video_preview`.
2. **Interpolation**: RIFE (`custom_nodes/comfyui-frame-interpolation`), 16 → 32 fps. Can sit in the same graph after the upscale.
3. **Shots Wan could not do**: MiniMax H3 (`playbooks/models/minimax_video.en.md`). Its own graph and manifest once checked.

When one of them is checked, this section is rewritten, and `final_i2v`/`final_flf` stay as the fallback.

## Acceptance criteria

- The video is the same take that was approved in `video_preview`, or better by the same criteria (`playbooks/stages/video_preview.en.md`).
- No artifacts that are tolerable in a sketch but not in the edit: extra fingers, a flickering face, morphing clothes, a jump in the last frames.
- The duration and the end of the action match the approved sketch.
- One file in `approve/` per shot. Shot watch (`AGENTS.md`, “Shot watch”) treats the shot as finished by that file.
