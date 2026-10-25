# Contract: graph binding manifest

Types: `src/lib/contracts/graph-binding.ts`. Check: `src/lib/contracts/graph-binding.test.ts` (`npm test`).

A ComfyUI graph in API format and the board code are linked only through a manifest. The code does not know node ids. A new workflow means putting the graph JSON and `<id>.bind.json` into `playbooks/workflows/comfy/`, with no code change.

## Where it lives

```
playbooks/workflows/comfy/
  location_krea2_api.json    # the graph (API format)
  location_krea2.bind.json   # the manifest, id = the file name without .bind.json
```

One graph can have several manifests (for example `video_ltx` for the preview and `final_ltx` for the final).

## Several workflows per stage

- Every manifest has exactly one `stage` and one `order`.
- The stage menu is all manifests of that stage by `order` (`StageDetail.workflows`, type `WorkflowChoice`).
- A choice is available (`available`) when every required input is present; otherwise `missing` lists the labels of the missing inputs.
- **The default** is the first available choice whose `whenSketch` matches (LTX preview → LTX final); otherwise the first available choice whose `defaultWhen` fits the shot (`speech` / `dialogue` / `silent`); otherwise the first available by `order`. If none is available, the first by `order`. The board never changes the choice itself: `suggestedWorkflow` only shows a suggestion.
- The user's choice is stored in the stage's `run_settings.json` (`{ "workflow": "<id>" }`). Only the board writes it (`PATCH .../stages/{stage}` with the field `runWorkflow`; an empty string resets to the default).
- A run uses `runWorkflow` from the body of `POST .../run`, otherwise `run_settings.json`, otherwise the default. Old names can be accepted through `aliases`.
- An agent can suggest another choice (`suggestedWorkflow` in `agent_request.json`, see `agent-request.md`). The board shows the suggestion and does not switch.
- A stage without manifests is not run by the board.

Functions (`src/lib/comfy/workflows.ts`): `listWorkflowChoices(ep, shot, stage)`, `resolveWorkflowId(ep, shot, stage, requested)`.

## Format

```json
{
  "format": "frameboard.graph-binding/1",
  "id": "first_frame_compositing",
  "graph": "qwen21_character_compositing.json",
  "stage": "first_frame",
  "label": "First frame: characters in the location",
  "description": "Places the approved characters (1–2) into the approved location.",
  "playbook": "models/qwen_first_frame.en.md",
  "order": 10,
  "aliases": [],
  "inputs": { "...": "see below" },
  "slots": [ "...see below" ]
}
```

| Field | Meaning |
|---|---|
| `id` | unique, equals the file name. Written to `run_settings.json` and to the queue job (`ComfyJob.workflow`) |
| `graph` | the graph file next to the manifest |
| `label` | the name in the menu, in English, for the user |
| `description` | one line: when to choose it |
| `playbook` | the model playbook for the agent (`.en.md`), a path from `playbooks/`. The agent writes `prompt.md` from the template there |
| `imageLabel` | how the model names pictures, `{n}` is the number: `<Picture {n}>` for MiniMax H3. If present, the agent gets the list of the graph's pictures under these names on any stage and calls people `<Subject N>`; if absent, it is `image {n}` and `characterN`, and the list appears only on the first frame |
| `order` | order in the menu, unique within a stage |
| `aliases` | old names for compatibility |

### `inputs`: the required inputs

Named. Three kinds:

```json
"location": { "kind": "image", "from": "approve:location", "pick": "newest", "label": "Approved location" },
"people":   { "kind": "image", "from": "approve:characters", "pick": "all", "min": 1, "max": 2, "label": "Approved characters" },
"view":     { "kind": "image", "from": ["refs", "library:location"], "pick": "first", "label": "General view" },
"end":      { "kind": "image", "from": "refs", "pick": "newest", "uploadAs": "{shotId}_end{ext}", "label": "Last frame in refs/" },
"text":     { "kind": "text", "from": "prompt", "required": true, "label": "prompt.md" },
"seconds":  { "kind": "number", "from": "settings:seconds", "fallback": "prompt:seconds", "min": 2, "max": 12, "label": "Clip duration" }
```

Pictures (`kind: image`):

| `from` | Where from |
|---|---|
| `refs` | `refs/` of this stage |
| `approve:<stage>` | `approve/` of another stage of this shot |
| `refs:<stage>` | `refs/` of another stage of this shot |
| `refs:other` | `refs/` of this stage without the shot characters' files (`{name}_face*`, `{name}_base*`, `{name}_clothes*`): things, clothes, pose samples from the user |
| `refs:other:<stage>` | the same from `refs/` of another stage of the shot. MiniMax H3 uses `refs:other`, and on the final otherwise `refs:other:video_preview`, otherwise `refs:other:first_frame`; slots 301–306 take the faces first and these references after them |
| `library:location` | `data/locations/<location from shot.md>/`: `view.png`, otherwise the first picture without `copy` in its name |
| `library:faces` | the characters' faces: one per file in `approve/` of the characters stage, in the same order (alphabetical). `refs/{name}_face.*` of this stage, otherwise in `data/characters/{name}/` a `face`, `portrait` or `portret` file (including `{name}_portret`, `portret_{name}`), otherwise the first picture with face or portr in its name, without side and copy. A character without a face is skipped |
| `library:faces-or-characters` | one picture per character from `approve/` of the characters stage, in the same order: a face sheet (`refs/{name}_face_sheet.*` of the stage, otherwise a picture with `face_sheet` in its name in `data/characters/{name}/`), otherwise the face (as in `library:faces`), otherwise the approved character itself. Nobody is dropped. In the agent task the sheet is marked "face sheet" |
| `library:face-sheets` | face sheets of the characters from `approve/` of the characters stage, in the same order: `refs/{name}_face_sheet.*` of the stage, otherwise a picture with `face_sheet` in its name in `data/characters/{name}/`. A character without a sheet is skipped |
| array | sources in order, the first non-empty one is used |

`maxAvailable` (on a picture input): a choice is available only if the input has at most that many files; otherwise `missing` gets the line "<label>: at most N (now M)". An input can have no slots and serve only as a condition.

`pick`: `first` is the first by name (numbers by value), `newest` is the newest by mtime, `all` is all by name, at most `max`. `min` (default 1) is how many are needed for `available`; `min: 0` makes the input optional. `uploadAs` is the file name when uploading to ComfyUI: `{shotId}`, `{episodeId}`, `{index}`, `{ext}` (the extension with a dot, lower case, `.png` by default); without it the file name is kept.

`requireSpeech: true` (on a `text` input): every line from the shot's `speech.md` must stand in the text word for word (letter case, spaces, quotes and the ellipsis do not count), otherwise the run fails with a list of the missing lines. A line with Cyrillic is not required and is not allowed in `prompt.md`: lines are written in English. Used by MiniMax H3: the model voices the shot itself.

`defaultWhen` (on a manifest): `speech` means the choice can be the default only if the shot has lines; `dialogue` means lines from two or more different speakers (the names before the colon in `speech.md`); `silent` means only if there are no lines.

`whenSketch` (on a manifest) wins over `defaultWhen`. A choice becomes the default if the newest video of input `of` (kind: video, `pick: newest`) was made by the given graph:

- the metadata has the key `prompt`, and the first node from `nodes` (`{ node, field }`) that has non-empty text in the saved graph is found;
- there is no key: the fallback is `filename`, a substring of the file name (`_ltx`). The name is not looked at when metadata exists, because the file could have been renamed at approval.

The `whenSketch` nodes belong to the graph that made the video, not to the graph of this manifest: the code does not check them against its own graph. If the matching choice is not available (inputs missing), the usual `defaultWhen` rules apply. If no suitable choice is available, the first available by `order`.

`target: "cloud"` + `cost: { credits, perSeconds }` (on a manifest): the run goes to Comfy Cloud (`COMFY_CLOUD_API_KEY` in `.env.local`) and costs money. `queueStageRun` queues it only with `allowCloud: true`: a checkbox on the stage page, for one run (`POST .../run` `{ allowCloud: true }`, or `.../agent-request` `{ allowCloud: true }`, in which case the board starts the cloud run after the agent replies). Without permission it is an error; the table buttons do not send such shots. `WorkflowChoice.cloud` is the price for the permission window.

`clamp: true` (on a number): a value outside `min..max` is pressed to the nearest bound instead of being rejected. `{ "seed": "random", "max": N }` is a random seed not above `N`.

`whenPrompt` is a regexp (flag `i`): the input is connected only if the stage's `prompt.md` matches it; otherwise the input is empty and `whenEmpty` applies. This way the agent decides whether an input is needed. An input with `whenPrompt` must be optional (`min: 0`). Example: `"whenPrompt": "\\bface from image \\d+\\b"`: the input goes only if the agent wrote that phrase. The agent sees the picture numbers in the task ("Images the graph receives").

`whenShot: "strictFirstFrame"`: the input is connected only if the shot has the "Strict first frame" checkbox on (`shots/{shotId}/shot_settings.json`, set on the preview or final page). Otherwise the input is empty and `whenEmpty` applies. The input must be optional (`min: 0`). This is not a picture for the model: it does not enter the `<Picture N>` list for the agent, and the task says instead that the first frame is pinned. MiniMax H3 (`video_minimax`, `final_h3_cinema`): the input `lock` puts the approved first frame into node `29`, and the `MiniMaxH3AddGuide` nodes (`400`, and `401` on the final for the second pass) pin it to frame 0. Without the checkbox they are removed, and the guiders `145`/`146` take `121` again.

You must not write paths or file names (`refs/x.png`, `lena_s01.png`) in `prompt.md`: the model sees pictures only by number. The board does not run such a prompt.

Text (`kind: text`):

- `from: "prompt"`: the stage's `prompt.md`, `trim()`, **with no filters**. `required: true`: an empty `prompt.md` is an error at run time.
- `from: "approve-meta"`: the text of a node from the metadata of the newest video of input `of` (kind: video, `pick: newest`). `nodes` are pairs `{ node, field }` in the saved graph; the first with non-empty text is taken. This way one manifest can read several possible nodes (for example `398:376` / `value`): the nodes are listed in the manifest, the code does not know them and does not check them against the graph of this choice. `fallback: "prompt"`: no video, no `prompt` key, or no text in any node: take the `prompt.md` of stage `stage` (no `stage` means the run's stage). The board appends a note to the run stage's `run_log.md`.

Text and number inputs do not affect `available`: the prompt is often written by the agent after the choice was made.

A `prompt.md` from old shots can start with a board instruction ("Build a shot variant…", "Rules: playbooks/…"). Such text is not sent to the model: the run fails with a clear error "rewrite prompt.md".

Number (`kind: number`, `from: prompt:seconds`): seconds from `prompt.md` ("5 sec", "5s"), within `min..max`. No number: the graph's value stays.

### Duration from the menu: `settings:seconds`

A number with `from: "settings:seconds"` is the user's choice in the stage menu: `durationSec` from `run_settings.json`. If it is chosen but outside this manifest's `min..max`, it counts as "not chosen".

- Not chosen: the source `fallback`. Only `"prompt:seconds"` is allowed now (seconds from `prompt.md`, as above). With no `fallback`, or no number there either, the graph's value stays.
- `min` and `max` are required, integers, `min <= max`: the board builds the menu from them (whole seconds, step 1). `fallback` on other sources is a manifest error.
- A manifest has at most one such input: there is one menu per stage.

The menu (`StageDetail.durationRange: { min, max, default } | null`) is built from the workflow that will run (the stage choice or the default). `default` is what goes without a choice: seconds from `prompt.md` (if `fallback`), otherwise the graph's value in the first target of this input's slot. `null` means the workflow has no `settings:seconds` input and no menu is shown. `StageDetail.durationSec` is the choice (within this menu) or `null`.

Only the board writes the choice: `PATCH .../stages/{stage}` with the field `runDuration`, a whole number of seconds (a number or a string from the select); an empty string or `null` resets to the default. Outside `min..max`, not an integer, or a workflow without a menu gives 400. `runWorkflow` and `runDuration` change only their own field of `run_settings.json`.

The choice reaches the agent as a line in the task: in `llm_task.md` "Clip duration: N s. The action must fit into this time.", in text mode (`AgentTask.user`) `clip duration: N s …`. The model playbook then must not write `N sec` in `prompt.md`.

### `slots`: where in the graph

```json
{ "targets": [{ "node": "470", "field": "image" }], "value": { "input": "location" } }
{ "targets": [{ "node": "903", "field": "image" }], "value": { "input": "people", "index": 1 },
  "whenEmpty": { "remove": [{ "node": "903" }, { "node": "488", "field": "images.image_3" }] } }
{ "targets": [{ "node": "102", "field": "seed" }, { "node": "112", "field": "seed" }], "value": { "seed": "random" } }
{ "targets": [{ "node": "104", "field": "filename_prefix" }], "value": { "template": "frameboard/location/{shotId}_v1_simple" } }
```

`targets` are node/field pairs of `inputs`. Both the node and the field must exist in the graph, otherwise there is an error naming the manifest, the node and the graph (no silent run). One value is written to all `targets`; `seed: random` gives its own random number per target.

`value`:

| Kind | What is substituted |
|---|---|
| `{ input, index? }` for a picture | the uploaded file name (`index` is the number in the input, 0 by default) |
| `{ inputs: [...], index }` | file number `index` from the inputs in a row (all files of the first, then of the second…). This is how the first frame fills `image_2`…`image_6` with characters and their portraits without gaps. The slot is required only if `index` is below the first input's `min` |
| `{ input, steps?, templates? }` for text | the input's text after `steps`, then the first matching template |
| `{ input }` for a number | the number |
| `{ seed: "random" }` | a new random integer |
| `{ template }` | a string: `{shotId}`, `{episodeId}`, `{stageId}`, `{workflow}` |

`whenEmpty.remove`: if there is no value (no picture with that `index`, no text, no number): remove nodes (without `field`) or `inputs` keys (with `field`). Without `whenEmpty`: an error for a required input, otherwise the graph's value stays.

`relink: ["node", number]` on a removal with `field`: do not delete the field but connect it to this output, so the link is restored around the removed node. Example: `{ "node": "145", "field": "conditioning", "relink": ["121", 0] }`.

### Text: `steps` and `templates`

Everything the board adds to `prompt.md` is visible in the manifest. There are no other text edits in the code.

```json
"steps": [
  { "namesTo": "the person" },
  { "ensure": "Static shot, fixed camera.", "at": "start", "unless": "\\b(camera|shot|static)\\b", "separator": " " },
  { "ensure": "Realistic, natural movement.", "at": "end", "unless": "realistic, natural movement", "separator": " " }
]
```

- `namesTo`: replace the character names from `shot.md` (as words, case-insensitive, longest first) with a phrase; collapse double spaces.
- `ensure`: add a phrase to the start or end through `separator` if the text does not match the regexp `unless` (flag `i`). For an empty text the phrase goes without a separator.

```json
"templates": [
  { "when": { "input": "people", "countAtLeast": 2 }, "text": "Place the person from image 2 and the person from image 3 into the location from image 1.\n{text}\nKeep the location from image 1 exactly as it is." },
  { "text": "Place the person from image 2 into the location from image 1.\n{text}\nKeep the location from image 1 exactly as it is." }
]
```

The first template whose `when` holds (the number of pictures in an input), or that has no `when`, is taken. Placeholders: `{text}`, `{shotId}`, `{episodeId}`. A line that is empty after substitution and consisted only of a placeholder is removed entirely.

The direction: it is better for the wrapping to live in the `prompt.md` template from the model playbook, with the manifest substituting `{text}` as is. `steps`/`templates` exist so that old behavior is visible and can change without code.

### Sections of `prompt.md`

When a graph needs several texts (the 4 branches of a location, the Refine sections of MiniMax H3), `prompt.md` is split by `## <name>` headings:

```json
"text": { "kind": "text", "from": "prompt", "required": true,
          "sections": ["simple", "objects", "camera", "camera_objects"], "untitled": "all", "label": "prompt.md" }
```
```json
{ "targets": [{ "node": "100", "field": "value" }], "value": { "input": "text", "section": "simple" },
  "whenEmpty": { "remove": [{ "node": "104" }] } }
```

- `sections` are the allowed names (lowercase Latin letters, digits, `_`). Another name, a repeated section, or text before the first heading is an error with a clear message.
- `untitled`: where text without headings goes: `all` means into every section (as before sections existed), a name means only into that section.
- An empty section triggers `whenEmpty` (for a location: remove the save node so the branch does not run). `required: true` on a value makes an empty section an error.
- `stage` on a text input is whose `prompt.md` it is. For `from: prompt` it is the text itself. For `approve-meta` it is the fallback file when the video has no prompt (final: `video_preview`).

### Paths inside a JSON string, constants

Some nodes get everything as one JSON in a string field. Target and removal accept `json`, a dotted path, with array indexes as numbers:

```json
{ "targets": [{ "node": "1", "field": "creator_data", "json": "segments.0.refined.body" }],
  "value": { "input": "text", "section": "body", "required": true } }
{ "targets": [{ "node": "1", "field": "creator_data", "json": "segments.0.assets.3.filename" }],
  "value": { "input": "people", "index": 1 },
  "whenEmpty": { "remove": [{ "node": "1", "field": "creator_data", "json": "segments.0.assets.3" }] } }
{ "targets": [{ "node": "1", "field": "creator_data", "json": "short_edge" }], "value": { "const": 1152 } }
```

- The parent of the path must be in the graph (checked at load).
- Removing an array element cuts it out; elements of one array are removed from the end, so the numbers do not shift.
- `const` is a value as is: a number, `true`/`false`, a string, an object.

### Videos and duration

- `kind: "video"` is like `image`, but the files are `mp4`, `webm`, `mov`, `mkv` (the same `from`, `pick`, `uploadAs`). They are uploaded to ComfyUI through the same `/upload/image`.
- A number with `from: "media:duration"`, `of: "<video input>"` is the video's duration from the `mvhd` atom (mp4/mov), rounded to a second, within `min..max`.

### Language of the text

The text for the model is checked before a run: a board instruction line ("Build …", "Rules: playbooks/…") or a line with Russian text (5+ Cyrillic letters, not counting the shot's character names, word-for-word lines from `shots/{shotId}/speech.md`, and a duration like "5 sec") is an error "rewrite prompt.md or send it to the agent". Old `prompt.md` files are translated by the script `npm run migrate-prompts` (without `--write` it only shows the plan).

## Metadata

A manifest does not add metadata-saving nodes.

- PNG: ComfyUI itself writes the graph into `tEXt`/`iTXt` chunks under the key `prompt` (`src/components/stage/png-metadata.ts`).
- Video: the file is written by `SaveVideo`. The node's hidden inputs are `prompt` (the graph in API format) and `extra_pnginfo`. In mp4/mov these are container keys (`movflags=use_metadata_tags`: atoms `moov/udta/meta/keys` + `ilst`, the value of `prompt` is the graph JSON). `CreateVideo` only assembles frames and writes no file. The board does not read webm/mkv as a prompt source. The parser is `readVideoPromptText` in `src/lib/comfy/binding.ts`.

## Who does what

| Who | What |
|---|---|
| `src/lib/comfy/*` | reads the manifests, checks them against the graph at load, builds the prompt, implements `listWorkflowChoices`/`resolveWorkflowId` from the manifests |
| `playbooks/**` | maintains graphs and manifests: when a graph is re-saved, update the manifest in the same commit and keep `npm test` green; adds new choices |
| UI | the workflow menu from `StageDetail.workflows`, the choice is a `PATCH` with `runWorkflow` |

## Current manifests

| id | Stage | Graph |
|---|---|---|
| `location_krea2` | location | `location_krea2_api.json` |
| `first_frame_compositing` | first_frame | `qwen21_character_compositing.json` |
| `video_ltx` | video_preview | `ltx25_i2v_api.json` (LTX 2.5 i2v, 24 fps, with sound); duration: `settings:seconds` → `prompt:seconds` → graph (node `398:362`), 2–10 s |
| `final_ltx` | final_render | `ltx25_i2v_api.json` (node `403`: 1.2 MP, 9:16 → 832×1472, 24 fps; `whenSketch` is the LTX preview) |
| `video_minimax` | video_preview | `minimax_h3_preview_api.json` (MiniMax H3 from references, 0.5 MP; `imageLabel: <Picture {n}>`). On a preview the default is `video_ltx` (order 5) |
| `final_h3_cinema` | final_render | `minimax_h3_cinema_api.json` (MiniMax H3 from references + the Cinema LoRA: the first frame plus one picture per character, `library:faces-or-characters`; `imageLabel: <Picture {n}>`; the preview prompt from `approve-meta` goes only into the agent task) |

The prompt built from these must match the current one (except random seeds).
