# Comfy graphs

Graphs in API format. The board runs them through the `*.bind.json` manifests (`docs/contracts/graph-binding.md`): a manifest says which files and which text go into which nodes. A new stage variant = a graph + a manifest, no code change.

| Manifest | Stage | Graph | Who runs it |
| --- | --- | --- | --- |
| `location_krea2` | `location` | `location_krea2_api.json` (Krea 2 Turbo, a location from scratch; how to re-save it — `drafts/README.md`) | the board; one paragraph in `prompt.md`, a picture from `refs/` is optional |
| `first_frame_compositing` | `first_frame` | `qwen21_character_compositing.json` | the board |
| `video_ltx` | `video_preview` | `ltx25_i2v_api.json` (LTX 2.5 i2v, 24 fps, with sound) | the board; prompt — `models/ltx_video.en.md` |
| `final_ltx` | `final_render` | the same `ltx25_i2v_api.json` (1.2 MP, 832×1472, 24 fps) | the board, the default when the sketch is LTX |
| `video_minimax` | `video_preview` | `minimax_h3_preview_api.json` (MiniMax H3 from references + the Cinema LoRA, one pass at 0.5 MP) | the board; "▶ All shots" runs it second, after `video_ltx` (`run_chain.json`) |
| `final_h3_cinema` | `final_render` | `minimax_h3_cinema_api.json` (MiniMax H3 from references + the Cinema LoRA) | the board; `prompt.md` is the whole model text, with `subject_definitions ASTROCINEMAV01K2T:` as the first line; the first frame is `<Picture 1>`, character faces are `<Picture 2…7>` |
| — | `characters` | `character_outfit_qwen21.json` (outfit edit, image 1 — the character, image 2 — the sample) | an agent following `characters_comfy.en.md`; the manifest is a draft in `drafts/` |

Drafts not yet checked in ComfyUI: `playbooks/workflows/drafts/`.

## After re-saving a graph

1. Export from ComfyUI in API format under the same name.
2. If node ids changed, fix the manifest in the same commit.
3. `npm test`: the manifest check (`src/lib/contracts/graph-binding.test.ts`) fails if a node, a field or a path inside the JSON disappeared from the graph.
