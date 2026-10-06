# Stage: video_preview

English copy for the model. Russian original: `playbooks/stages/video_preview.md`.

Low resolution: check the movement. Wan 2.2 turbo sketch, 384×672, 16 fps. The board runs the graph.

Prompt: `playbooks/models/wan_video.en.md`, template in section 8. How the graph is built: `playbooks/workflows/video_preview_comfy.en.md`.

## Variants

| Manifest id | order | Graph | Inputs |
| --- | --- | --- | --- |
| `video_i2v` | 10 | `wan22_i2v_sketch_turbo_api.json` | the newest file in `first_frame/approve/`, `prompt.md` |
| `video_flf` | 20 | `wan22_flf_sketch_turbo_api.json` | the same + the newest picture in this stage's `refs/` as the last frame |

The board defaults to `video_i2v`. FLF is available only when `refs/` has a picture.

## Which variant

| Situation | Variant |
| --- | --- |
| A simple action, one or two phases, everything starts from the first frame | `video_i2v` |
| A specific end pose or shot size is needed (the character walks up to the camera, sits down in a given spot) | `video_flf` |
| An object changes state (a crack, a stain, broken glass) | `video_flf` with a last frame in the needed state |
| An action against the model's habit (bring a spoon up and not eat) | `video_flf` or another shot |
| Two or three i2v rounds do not move the result | `video_flf` |
| Physical contact of two people | neither: Seedance or a reference video outside the board. Note it in `run_log.md` |

An agent that sees another variant is needed writes `suggestedWorkflow` in `agent_request.json` (`docs/contracts/agent-request.md`): `video_flf` or `video_i2v`. The board shows the suggestion and does not switch by itself. For FLF the last frame in `refs/` is added by the user (or by the agent, when the request is about references).

## What changes in the graph

Only what the manifest says: the first frame, the last frame (FLF), `prompt.md` as is, the seed, the duration (when `prompt.md` ends with `N sec`, 2–8), the prefix `frameboard/video/{shotId}_i2v` or `_flf`. The negative, steps, CFG, LoRA and size come from the graph and do not change. With no number the duration is 5 seconds from the graph.

## Acceptance criteria

A good sketch:

- The first video frame matches the approved first frame: the same people, clothes, place. The picture is not stretched (the first frame is exactly 9:16).
- The main action from `shot.md` happens, and only that. No extra people, hands, or objects that move by themselves.
- The action fits the duration and ends in its end state instead of cutting off in the middle. If the action must stay unfinished (the braid is not finished), it is not finished.
- The camera does what is written: it stays, or makes one movement.
- The strength of the movement matches the text: “slight” is slight, not the maximum.
- For FLF the last video frame matches the picture in `refs/`, and the transition has no jump.
- The face and clothes hold for the whole length, no morphing.

Small sketch artifacts (noise, softness, low resolution) do not block acceptance: this is a movement preview. Reject when the movement itself is wrong.

## Do not

- Do not write a negative: in turbo at CFG 1 it takes no part.
- Do not run full mode (20 steps, no turbo): it is usually worse.
- Do not change more than one thing per round: the text, the duration, or the first frame.
