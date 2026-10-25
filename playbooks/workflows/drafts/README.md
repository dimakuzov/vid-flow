# Graph and manifest drafts

`npm test` does not read this folder. Move a draft into `workflows/comfy/` only after checking it in ComfyUI.

| File | What | What is needed before moving |
| --- | --- | --- |
| `character_outfit.bind.json` | The outfit manifest for the real graph `workflows/comfy/character_outfit_qwen21.json` (node ids checked) | The contract has no `forEach`, `library:character`, `match`: the board needs a walk over the shot's characters |
| `final_h3_base_reference.md` | H3 final from a base low-res H3 clip (template `create_final_video_using_base_reference`) | The user's answers to the questions in the file |
| `first_frame_text.bind.json` | First frame with no characters and no location, the same assembly graph, 0–3 pictures in refs/, with no pictures — text-to-image | The contract has no `when.shot`: without it the variant becomes the "default" for shots with characters while they have no approve yet |

## Krea 2: a location graph from scratch

The user's graph already lies in `workflows/comfy/location_krea2_api.json`, its manifest is `workflows/comfy/location_krea2.bind.json` (the node test passes). There is nothing to move into drafts. Below is how to re-save the graph if it changes.

1. In ComfyUI open the Krea 2 graph (dining room, `The_dining_room`). Check that a run in ComfyUI passes.
2. The nodes the board needs (ids as of now):

   | id | Type | Field the board writes |
   | --- | --- | --- |
   | `61` | `PrimitiveStringMultiline` (Text String) | `value` — the whole `prompt.md` |
   | `66` | `TextEncodeQwenImageEditPlus` | `image1` — removed when there is no picture |
   | `67` | `LoadImage` | `image` — the first file of `refs/` or the general view from `data/locations/` |
   | `49` | `ResolutionSelector` | `aspect_ratio` = `9:16 (Portrait Widescreen)` |
   | `54` | `KSampler` | `seed` — random |
   | `29` | `SaveImage` | `filename_prefix` = `frameboard/location/{shotId}_krea2` |

   The LoRAs (`60`, `65`), the switch `63`, steps, cfg and the sampler are not touched by the board: change them in ComfyUI.
3. Save in API format: menu **Workflow → Export (API)** (in the old interface — enable Dev mode in settings and press **Save (API Format)**). The file name is `location_krea2_api.json`.
4. Put the file into `playbooks/workflows/comfy/`, replacing the old one.
5. If node ids changed, write the new ones into `location_krea2.bind.json` (the `node` field in `slots`). If `LoadImage` was deleted, remove the first slot and the `view` input.
6. `npm test`: the manifest test says which node or field is missing.
