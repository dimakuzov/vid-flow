# Stage: final_render

English copy for the model. Russian original: `playbooks/stages/final_render.md`.

## Decision: the final is MiniMax H3 from the approved preview

The final render is made by MiniMax H3 (the `MiniMaxH3Creator` node, ComfyUI-Continuity): the low-res Wan video from `video_preview/approve/` is the motion reference, the approved first frame is the final's first frame, character references give the faces. How to write the text and the `prompt.md` format: `playbooks/models/minimax_h3.en.md`. `prompt.md` is always English. Do not translate any of it into Russian.

## Variants

| manifest id | order | Graph | When |
| --- | --- | --- | --- |
| `final_heygen` | 2 | `heygen_video_i2v_api.json`, HeyGen Video 1.0 in **Comfy Cloud** (paid, ~45.3 credits per 10 s, 5–15 s), from the approved first frame, the preview's length | default for a **dialogue** (two or more speakers in `speech.md`); runs only after the box «Разрешить платную отправку в Comfy Cloud» is ticked for this run. Prompt: `playbooks/models/heygen_video.en.md` |
| `final_wan_720` | 3 | `wan22_i2v_sketch_turbo_api.json`, 720×1280, 24 fps, the sketch's prompt and first frame, the preview's length | default for a shot **without lines**, when the sketch is not LTX |
| `final_h3_768_face` | 4 | `minimax_h3_creator_api.json`, 768, face pass | default for a shot **with one speaker** (`speech.md`): MiniMax voices it and moves the lips |
| `final_h3` | 5 | same graph, 1152, face pass | faces and the shot needs the higher resolution |
| `final_h3_768` | 6 | same graph, 768, no face pass | no people, small faces, faster and less memory |
| `final_ltx` | 7 | the same graph as `video_ltx` (`ltx25_i2v_api.json`), 1.2 MP (832×1504), 24 fps | default when the approved sketch was made with LTX. This wins over the line rows |
| `final_i2v` | 10 | `wan22_i2v_sketch_turbo_api.json` | fallback: repeat the Wan sketch on new seeds |
| `final_flf` | 20 | `wan22_flf_sketch_turbo_api.json` | fallback when the sketch was FLF (last frame in this stage's `refs/`) |

H3 needs a file in `video_preview/approve/` and in `first_frame/approve/`. Character references come from this stage's `refs/`, otherwise from `characters/approve/` (up to two). If a face is not visible in the shot, put only the needed file into `refs/` or choose `final_h3_768`.

The board makes sure the H3 prompt holds to the preview: if the `body` of `prompt.md` lacks the fixed phrase (`use @vid-1 as a reference`), the board puts it first; if it lacks `required motion guide`, the board adds the closing line at the end (first frame and preview required, quality free, lips re-animated). H3 does not run when a line of `speech.md` is missing from `prompt.md`.

The Wan final gets one more line at the end of the sketch prompt: the background stays as in the first frame, no new people, nobody walks behind, doors and windows stay as they are. At 720×1280 Wan otherwise invents details (people in the back, opening doors). Details: `playbooks/models/minimax_h3.en.md`, «The fixed phrase».

## Which variant is the default

The board looks at the newest file in `video_preview/approve/`. An LTX sketch selects `final_ltx`, even when the shot has lines. Otherwise the lines decide. The board does not guess that an end pose is needed.

| Situation | Variant | Who decides |
| --- | --- | --- |
| The approved sketch was made with LTX | `final_ltx` | the board, the default |
| Nobody speaks, and the sketch is Wan | `final_wan_720` | the board, the default |
| One speaker | `final_h3_768_face` | the board, the default |
| Two or more speakers | `final_heygen` | the board, the default. It runs only after the box «Разрешить платную отправку в Comfy Cloud» is ticked for this run |
| The sketch was FLF, or a specific end pose is needed | `final_flf` | the agent writes `suggestedWorkflow`. The last frame goes in this stage's `refs/` |
| Faces, and the shot needs the higher resolution | `final_h3` | the agent suggests |
| No people, small faces | `final_h3_768` | the agent suggests |

How the board knows the sketch graph: the video metadata (the `prompt` key, written by SaveVideo) has non-empty text in node `398:376` / `value` — that is LTX. No metadata — it looks at the file name: the substring `_ltx` (`s01_ltx_00001_.mp4`). It does not look at the name when metadata is present: the file may have been renamed. Details: `docs/contracts/graph-binding.md`.

The Wan final, the LTX final, and the source prompt inside H3 take that text from the same video (Wan node `129:93` / `text`, or LTX node `398:376` / `value`, whichever the metadata has). No metadata — `prompt.md` of stage `video_preview`, and the board appends a note to the final's `run_log.md`. A later edit of `prompt.md` without a new video does not reach the final.

An agent whose selected variant is not the row above writes the id in `suggestedWorkflow`. The board shows the suggestion and does not switch.

## Not checked yet

- Upscale to 1080×1920 (SeedVR2) and frame interpolation 16 → 32 fps (RIFE) — not on the board.
- `final_h3` through the MiniMax cloud API — not connected; the local vs API guide is with the user (`minimax_h3_final_render_guide.md`).
- “Final from a base low-res H3 video” (template `create_final_video_using_base_reference`): a draft description in `playbooks/workflows/drafts/final_h3_base_reference.md`, no graph or manifest.

## Acceptance criteria

- The action, composition and ending match the approved preview. The final does not invent new events.
- The first frame matches the approved first frame.
- Faces match the character references, clothes match the first frame.
- No artifacts that are tolerable in a sketch but not in the edit: extra fingers, a flickering face, morphing clothes, sparkles, a jump in the last frames.
- The duration matches the preview.
- One file in `approve/` per shot. Shot watch (`AGENTS.md`, “Shot watch”) treats the shot as finished by that file.
