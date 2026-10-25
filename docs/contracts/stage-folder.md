# Contract: the stage folder and status

Folder: `data/episodes/{episodeId}/shots/{shotId}/{stage}/`.

## Files and who writes them

| File | What it is | Written by | Agent |
|---|---|---|---|
| `refs/` | the stage's input pictures | the user (upload; keep out of the graph with "Remove", delete by hand in the folder), the agent (if it rebuilds the references) | yes, by the request rules; never delete |
| `output/` | results | the Comfy queue, the agent (characters), upload, crop and edit; only the user deletes, with a button | add only |
| `output/edits.json` | the link of a new file to its source: `{ file, from, kind: crop \| edit, prompt?, workflow?, at }` | the board (crop and edit) | no |
| `approve/` | the chosen result | the approve button, the agent (characters) | only by the playbook |
| `prompt.md` | **exactly the text that goes to the model**, in the model's language. New shots get an empty file | the user, the agent (or the board in the agent's text mode) | yes |
| `run_settings.json` | the stage choices: `{ "workflow": "<manifest id>", "durationSec": 4, "excluded": ["<path from data/>"], "characterImage": { "<name>": "<path>" } }` (`docs/contracts/graph-binding.md`) | the board (PATCH of the stage, fields `runWorkflow`, `runDuration`, `exclude`, `characterImage`) | no |
| `run_settings.log` | a journal of changes to the graph inputs: one JSON line per Remove, Restore or picked character picture, with the time and where the request came from | the board | no |
| `../speech.md` (in the **shot** folder, `shots/{shotId}/speech.md`) | the shot's spoken lines: what the characters say aloud, word for word, one line per row (`Katya: Mom, I'm home.`). No file means silence. The "Lines" field under the prompt on the `video_preview` and `final_render` stages; it does not go to the model directly, the agent gets it in the task | the user (PATCH of the stage or POST agent-request, field `speech`; empty deletes the file) | read |
| `../agent.json` (in the **shot** folder) | the shot's agent: `{ provider, model, updatedAt }`, used for all runs of the shot (`docs/contracts/agent-request.md`, "The shot's agent") | **the board only** | no |
| `llm_notes.md` | the recommendation input field on the board | the user; the board clears it when sending | no |
| `refs.md`, `workflow.md` | notes | the user, the agent | yes |
| `status.json` | the expected characters, a note. The `status` field is informational | the board | no |
| `stage_state.json` | the stage's active operation (phase) | **the board only** | no |
| `agent_request.json/.md`, `llm_task.md` | the request to the agent (`docs/contracts/agent-request.md`) | the board; the agent sets `status: done` | only `status` (and `suggestedWorkflow`) |
| `agent_dispatch.json` | the link between a request and a Comfy job | the board | no |
| `agent_baseline.json`, `agent_touch.json` | a snapshot of refs for comparison | the agent / the board | yes |
| `prompt_history.json` | earlier versions of `prompt.md` | the board | no |
| `run_log.md` | the log of agent runs | the agent | append |

## Editing a picture

The "Edit" button on a picture in `output/` and `approve/` (and in the viewer). The source file is neither changed nor deleted.

- The crop is computed in the browser. `POST .../crop` (form: `file`, `source`, `folder`) puts a new PNG into `output/` as `{name}_crop.png`. A name clash gets a suffix, as with an upload.
- Edit and improve: `POST .../edit` with `{ filename, folder, workflow, text, megapixels? }`. An empty `text` is a ready prompt: slightly better textures and fine detail, objects, light and camera as they are, and Claude is not called. A non-empty text is turned into a prompt by Claude Haiku 5.5 without the picture, following `playbooks/models/image_edit.en.md`: first the request, then keeping whatever it does not touch; the camera does not move. If Claude is not available, a plain template is used. `megapixels` is written to node 13; without the field the graph keeps its own number. The job goes to the ComfyUI queue, the expected file is `{name}_edit_v1.png`. The workflows live in `playbooks/workflows/comfy/edit/` and are not in the stage menu. The graph file does not change. In the dialog the frame is 9:16 by default. "Apply improvement" with a frame that does not cover the whole picture first saves the crop and queues the job from it.
- `GET .../edit` is the list of links and edit workflows. If the queue saved the file under another name, the link is updated to it.
- A reference from the library, another stage or another shot: `GET/POST .../ref-sources`. The file is copied into `refs/`, and `agent_touch.json` marks the user's edit.

## Deleting files

The trash can on a file card in `output/` deletes the file from disk for good (`fs.unlinkSync`, not to the Windows recycle bin), after the question "Delete file … forever?". That question is the user's confirmation; the agent never deletes from these folders on its own. `refs/` has no trash can on the board: there is "Remove from the graph" (below), and the user can delete a file by hand in the folder. The route `DELETE .../files` still accepts `refs` too.

- Only the file name (`path.basename`, no `..` and `/`), only inside the stage folder, only an existing file.
- `refs/`: after a deletion the board writes `agent_touch.json` with `refsTouchedByUser: true` (as with an upload), so the agent does not rebuild refs.
- A busy stage (`agent`, `queued`, `running`): deleting from `output/` is allowed, from `refs/` it is not (the graph or the agent may be reading them), with the error "The stage is busy…".
- `output/` became empty and `status.json` was `review`: the board writes `prep`.
- `approve/` is not here: "Remove" (`DELETE .../approve`).

## Remove from the graph (`run_settings.json`, `excluded`)

Any input of a stage (`refs/`, approve of other stages, the library, faces) can be kept out of this stage's graph without deleting the file, and brought back with the same button ("Remove" / "Restore" on the card). This also covers files the user added.

- `PATCH .../stages/{stage}` with `{ "exclude": { "path": "<MediaFile.relativePath>", "excluded": true | false } }` returns `StageDetail`. Only for a free stage. Removing a file that is picked as a character also clears that pick (`characterImage`).
- The list is stored in `run_settings.json` → `excluded` (paths from `data/`: `episodes/ep2/shots/s01/first_frame/refs/x.png`, `characters/Lena/portrait.png`). Only for this stage: on other stages the same file stays an input.
- Every change is also written to the journal `run_settings.log`.
- `resolveImageInput` skips removed files. A source where only removed files are left counts as empty, and the input takes the next source (`["refs", "approve:characters"]`: its own refs removed, so the characters' approve).
- The agent sees the list in the task ("Removed from the graph by the user") and does not use, delete or restore these files.
- `StageDetail.excluded` is the list of paths; `StageInput.excluded` is the removed files of that input (pale on the page, with "Restore").

## The character picture (`characterImage`)

On the characters stage the buttons "From output", "From a reference" and "From the previous shot" put a picture in as the character (image 1) at once. If the source has several pictures, each next press takes the next one and wraps around after the last. `PATCH .../stages/characters` with `{ "characterImage": { "name": "lena", "path": "<relativePath>" } }` stores the pick in `run_settings.json`; an empty `path` returns to `{name}_base.*` or the library. Picking a file that was removed from the graph restores it. In the library, the base is `full_body.png`, then `body.png`, then `{folder}_body.png` / `{folder}_full_body.png`, then the first picture without `copy` in its name.

## Stage inputs (`StageDetail.inputs`)

`stageInputs(ep, shot, stage)` in `src/lib/series/stage-inputs.ts` is what the graph takes by default. Read only. On the stage page it is the "What goes into the graph" block above "References".

`StageInput = { label, source, files: MediaFile[], excluded: MediaFile[] }`.

- A stage with manifests: the `image`/`video` inputs of the selected workflow (`run_settings.json`, otherwise the default). For each, the first non-empty source, as at run time (`resolveImageInput`). `source` reads "approve of stage Location", "refs/ of this stage", "library data/locations/cafe/". If all sources are empty: `files: []`, `source: "empty: …"`.
- `characters`: per shot character, the base (see "The character picture") plus the clothing samples from `refs/`.
- Files removed by the user are in `excluded`, not in `files` (see "Remove from the graph").
- Library files are served through `/api/media/{characters,locations}/...`.

## Cell status

The active operation (`stage_state.json`) overrides the status derived from the folders.

| Status | From | Meaning |
|---|---|---|
| `agent` | `stage_state.phase = agent` | the request is sent, waiting for `done` from the agent |
| `queued` | `phase = comfy`, job `pending` (or `running` without `promptId`) | the job is in `data/comfy_queue`, ComfyUI has not accepted it yet (including when it is off) |
| `running` | `phase = comfy`, job `running` with `promptId` | ComfyUI is generating |
| `error` | `phase = error` or job `error` | the text is in `stage_state.error` / `job.error` |
| `approved` | the `approve/` folder (for characters, a file for every character) | |
| `review` | there are files in `output/` | |
| `prep` | there is `prompt.md` / `workflow.md` | |
| `empty` | nothing is there | |

While the status is `agent`, `queued` or `running`, the stage is busy: "Send to agent" and "Run" return an error, and the prompt and recommendation fields are read only. "Cancel" (`POST /api/shots/{shotId}/stages/{stage}/cancel`) marks the request `cancelled` and the queue job `cancelled` (removing it from ComfyUI if it already went) and returns the stage to `idle`. "Reset error" is the same route.

## `stage_state.json`

```json
{
  "phase": "idle | agent | comfy | error",
  "since": "ISO",
  "requestId": "s01-location-...",
  "jobId": "s01-location-...",
  "agentRunsComfy": false,
  "error": "text",
  "updatedAt": "ISO"
}
```

## Transitions

| From | To | Who | When |
|---|---|---|---|
| any free | `agent` | `submitAgentRequest` | "Send to agent" |
| any free | `comfy` | `queueStageRun` | "Run" |
| `agent` | `comfy` | the background loop (`reconcileStage`, every 3 s) | the agent set `done`, the board runs the stage |
| `agent` | `idle` | the background loop | the agent set `done` and ran Comfy itself (characters) |
| `agent` | `error` | the background loop | no answer for longer than `FRAMEBOARD_AGENT_TIMEOUT_MIN` (60 by default) |
| `comfy` | `idle` | the background loop | the job is `done` (files in `output/` give status `review`) |
| `comfy` | `error` | the background loop | the job is `error` or the job file disappeared |
| `error` | `idle` | approve, an upload to output, "Reset error" | |
| busy | `idle` | "Cancel" | |

Reading the status (`readStageState`) writes nothing: it takes the `queued/running/done` phase from the job file by `jobId`. Only the background loop and the API routes write transitions.

The background loop (`reconcileAllStages`) walks **all** episodes, not only the open one.

## The episode is always an explicit parameter

`current_episode.txt` is only the interface's default choice (what to show on `/`). No function in `src/lib/**` reads it by itself, except `scanSeries()` without an argument and `requireCurrentEpisodeId()` for routes where no episode is passed.

The order of arguments everywhere: `episodeId, shotId, stageId, ...`. Functions with an options object get the field `episodeId`.

| Module | Functions |
|---|---|
| `paths.ts` | `episodeRoot(ep)`, `shotsDir(ep)`, `shotDir(ep, shot)`, `stageDir(ep, shot, stage)`, `ensureStageDirs(ep, shot)`, `ensureEpisodeScaffold(ep)`, `listShotIds(ep)`, `agentInboxRelative(ep)`, `createEpisode(ep)` (does not change the open episode), `prepareDataRoot()` (at process start), `isInside(root, target)` |
| `stage-state.ts` | `readStageStateFile`, `writeStageState`, `setIdle`, `setError`, `readStageState`, `assertStageFree`, all `(ep, shot, stage, ...)` |
| `status.ts` | `readStatusFile`, `writeStatusFile`, `deriveStageStatus(ep, shot, stage, chars)`, `charactersApproved`, `locationApproved` |
| `shot-meta.ts` | `readShotMeta(ep, shot)`, `writeShotMeta(ep, meta)` |
| `shot-watch.ts` | `readShotWatch(ep, shot)`, `setShotWatchStopped(ep, shot, stopped)` |
| `prompt-history.ts` | `syncPromptHistory(ep, shot, stage)`, `restorePromptVersion(ep, shot, stage, id)` |
| `mutations.ts` | `saveUpload({episodeId,...})`, `approveFiles({episodeId,...})`, `updateStageDocs({episodeId,...})`, `removeApprovedFile(ep, shot, stage, name)`, `deleteStageFile(ep, shot, stage, folder, name)`, `listApprove(ep, shot, stage)`, `deleteShot(ep, shot)` |
| `scanner.ts` | `scanSeries(ep?)` (without an argument, the open episode), `getStageDetail(ep, shot, stage)` |
| `bootstrap.ts` | `applyBootstrap({episodeId,...})` (required), `readScenarioText(ep)`, `readRawScenarioText(ep)` |
| `agent-request.ts` | `submitAgentRequest({episodeId,...})`, `readAgentRequest`, `readAgentRequestSummary`, `readAgentDispatch`, `writeAgentDispatch`, `stageBoardQueues`, `cancelAgentRequest`, all `(ep, shot, stage)`; `rebuildAgentInbox(ep)`. `agent_request.json` has the field `episodeId` |
| `agent-dispatch.ts` | `reconcileStage(ep, shot, stage)`, `reconcileAllStages()`, `cancelStage(ep, shot, stage)` |
| `comfy/stage-run.ts` | `queueStageRun(ep, shot, stage, options)`. A queue job stores `episodeId`, `shotId`, `stageId` |
| `route-params.ts` | `parseStageParams`, `parseShotParams`: validation of the path parameters in routes |

`SERIES_ROOT` still replaces the folder of a single episode: `listEpisodeIds()` returns its name, `episodeRoot()` returns that path.

Reading without writes: `scanSeries()` writes nothing. Migrating the old `data/series/` layout and creating the shared folders is `prepareDataRoot()` in `src/instrumentation.ts` and in scripts. The exception is `getStageDetail()`: it syncs `prompt_history.json` to catch an agent's edit of `prompt.md`.

## API

Everything that belongs to a shot is under the episode:

| Method and path | What it does | Function |
|---|---|---|
| `GET /api/episodes/{ep}` | the episode summary for the table | `scanSeries(ep)` |
| `DELETE /api/episodes/{ep}/shots/{shot}` | remove a shot | `deleteShot` |
| `POST /api/episodes/{ep}/shots/{shot}/watch` | "Finish shot" | `setShotWatchStopped` |
| `GET, PATCH /api/episodes/{ep}/shots/{shot}/stages/{stage}` | the stage: read, save documents | `getStageDetail`, `updateStageDocs` |
| `POST .../stages/{stage}/upload` | upload to `refs/` or `output/` | `saveUpload` |
| `POST, DELETE .../stages/{stage}/approve` | approve / remove from `approve/` | `approveFiles`, `removeApprovedFile` |
| `DELETE .../stages/{stage}/files` `{folder: "output" \| "refs", filename}` | delete a file for good, the answer is `StageDetail` | `deleteStageFile` |
| `POST .../stages/{stage}/prompt-history` | restore a prompt version | `restorePromptVersion` |
| `POST .../stages/{stage}/agent-request` | send to the agent | `submitAgentRequest` |
| `POST .../stages/{stage}/run` | queue a run | `queueStageRun` |
| `POST .../stages/{stage}/cancel` | cancel / reset the error | `cancelStage` |

Series level:

| Method and path | What it does |
|---|---|
| `GET /api/series` | the summary of the open episode (`current_episode.txt`) |
| `POST /api/series/episode` `{episodeId}` | create an episode and make it open |
| `GET /api/series/bootstrap?episodeId=` · `POST` `{episodeId, ...}` | the episode script, creating shots. Without `episodeId`, the open episode |
| `POST /api/series/format-request` `{episodeId, rawText}` | send a raw script for formatting |
| `GET /api/media/episodes/{ep}/...` | episode files (read only) |
| `GET /api/media/{characters,locations,references}/...` | the shared libraries (read only) |
| `GET, POST /api/comfy/queue` | queue jobs (`docs/contracts/comfy-job.md`) |
| `GET, POST /api/comfy/transport` | the Comfy transport, `sdk` or `legacy` (`docs/COMFY_SDK.md`) |

`/api/media` serves only files inside these folders; `..`, `comfy_queue/`, `current_episode.txt` and a neighboring episode with a shared prefix (`e010` for `e01`) give 403. `MediaFile.relativePath` is from `data/`: `episodes/e01/shots/s01/location/output/x.png`.
