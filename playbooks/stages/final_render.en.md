# Stage: final_render

## Decision: the final with lines is MiniMax H3 Cinema from the first frame and the faces

A shot with one speaker is made by MiniMax H3 in reference mode with the Cinema LoRA (`final_h3_cinema`): the approved first frame is `<Picture 1>`, one picture per character gives the face, and the text carries the motion of the approved preview. There is no video reference. The user chose this graph because it keeps the quality and the likeness stable; the old H3 graph with the low-res video as a reference (`MiniMaxH3Creator`) often failed and is removed. How to write the text and the `prompt.md` format: `playbooks/models/minimax_h3.en.md`. `prompt.md` is always English.

## Variants

| manifest id | order | Graph | When |
| --- | --- | --- | --- |
| `final_h3_cinema` | 4 | `minimax_h3_cinema_api.json`, MiniMax H3 reference to video + Cinema LoRA, two passes (1 MP, then the latent upscale to 1.5 MP), 24 fps, the preview's length | default for a shot **with one speaker** (`speech.md`): MiniMax voices it and moves the lips |
| `final_ltx` | 7 | the same graph as `video_ltx` (`ltx25_i2v_api.json`), 1.2 MP (832×1472), 24 fps | default when the approved sketch was made with LTX. This wins over the line rows |

H3 Cinema needs a file in `first_frame/approve/`. The approved preview gives the duration and the motion the agent writes into the text. Character pictures, one per character in the order of `characters/approve/`: this stage's `refs/` if it has files, otherwise the character's face sheet (`refs/{name}_face_sheet`, then `*face_sheet*` in the library), otherwise one face (`refs/{name}_face`, then the library portrait), otherwise the approved character; up to six. The task lists them as `<Picture 2>`, `<Picture 3>`, …

The board puts `subject_definitions ASTROCINEMAV01K2T:` (the Cinema LoRA trigger) first when `prompt.md` lacks it. H3 does not run when an English line of `speech.md` is missing from `prompt.md`.

## Which variant is the default

The board looks at the newest file in `video_preview/approve/`: the final follows the approved preview. An LTX sketch selects `final_ltx`, a MiniMax sketch selects `final_h3_cinema` (its prompt is already in the MiniMax form), even when the lines would say otherwise. Otherwise the lines decide. The board does not guess that an end pose is needed.

| Situation | Variant | Who decides |
| --- | --- | --- |
| The approved sketch was made with LTX | `final_ltx` | the board, the default |
| The approved sketch was made with MiniMax | `final_h3_cinema` | the board, the default |
How the board knows the sketch graph: the video metadata (the `prompt` key, written by SaveVideo) has non-empty text in node `398:376` / `value` — that is LTX. No metadata — it looks at the file name: the substring `_ltx` (`s01_ltx_00001_.mp4`). It does not look at the name when metadata is present: the file may have been renamed. Details: `docs/contracts/graph-binding.md`.

The LTX final and the sketch prompt in the H3 Cinema task take that text from the same video (LTX node `398:376` / `value`). No metadata — `prompt.md` of stage `video_preview`, and the board appends a note to the final's `run_log.md`. A later edit of `prompt.md` without a new video does not reach the final.

An agent whose selected variant is not the row above writes the id in `suggestedWorkflow`. The board shows the suggestion and does not switch.

## Not checked yet

- Upscale to 1080×1920 (SeedVR2) and frame interpolation 16 → 32 fps (RIFE) — not on the board.
- MiniMax H3 through the MiniMax cloud API — not connected.

## Acceptance criteria

- The action, composition and ending match the approved preview. The final does not invent new events.
- The first frame matches the approved first frame.
- Faces match the character references, clothes match the first frame.
- No artifacts that are tolerable in a sketch but not in the edit: extra fingers, a flickering face, morphing clothes, sparkles, a jump in the last frames.
- The duration matches the preview.
- One file in `approve/` per shot. Shot watch (`AGENTS.md`, “Shot watch”) treats the shot as finished by that file.
