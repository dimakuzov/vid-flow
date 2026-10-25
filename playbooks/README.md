# Global playbooks

These documents are global for all series. Do not copy them into a series folder.

Structure:

- `models/` — how to write prompts for a specific model
- `stages/` — what each shot stage does and which base it depends on
- `workflows/` — how to run Comfy by hand
- `workflows/comfy/` — the JSON graphs themselves

Series identity bases (not playbooks):

- `data/characters/{name}/` — portrait, side, full body
- `data/locations/{locationId}/` — the general view of a location
- `data/references/` — shared series references, not a shot's refs
- `data/scenarios/` — script documents, not the series' working `scenario.md`

The shot stages `characters` and `location` build a shot variant from these bases. The stage contract is the same: `refs/`, `output/`, `approve/` and five documents.

Rules of the shot character (Qwen Image 2.1 outfit edit from a clothing sample, checked on teaser s07):

- `stages/characters.en.md`
- `models/qwen_image.en.md`
- `workflows/characters_comfy.en.md`
- `workflows/comfy/character_outfit_qwen21.json`

Location (Krea 2 from text):

- `stages/location.en.md`
- `models/krea2_location.en.md`
- `workflows/comfy/location_krea2_api.json`

First frame (place the approved characters into the approved location):

- `stages/first_frame.en.md`
- `models/qwen_first_frame.en.md`
- `workflows/first_frame_comfy.en.md`
- `workflows/comfy/qwen21_character_compositing.json`

Playbooks are English only (`.en.md`): agents read them, there are no other-language copies. The stage page shows the path to `stages/{stage}.en.md`, `workflows/{stage}_comfy.en.md` and the model playbook. The character graph is visible on the `characters` stage, the location graph on `location`, the frame assembly graph on `first_frame`.
