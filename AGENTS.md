# Frameboard agent notes

This repo is a local-first board for structuring video generation.

## Important paths
- One series for the whole project. Shared libraries: `data/characters/{name}/`, `data/locations/{locationId}/`, `data/references/` (shared pictures), `data/scenarios/` (scenario documents)
- `data/scenarios/` is the document library. The board still reads the working cut from `data/episodes/{episodeId}/scenario.md`
- Episodes: `data/episodes/{episodeId}/`. Current episode id: `data/current_episode.txt`
- `DATA_ROOT` overrides the `data/` directory. `SERIES_ROOT` overrides the current episode directory
- Shot variants stay in `data/episodes/{episodeId}/shots/sXX/` and are built from those libraries
- Global playbooks: `playbooks/`
- Character outfit graph: `playbooks/workflows/comfy/character_outfit_qwen21.json`
- Location Comfy graph: `playbooks/workflows/comfy/location_views_multiple_angles.json`
- First-frame Comfy graph: `playbooks/workflows/comfy/qwen21_character_compositing.json`
- Bootstrap instructions: `docs/AGENT_BOOTSTRAP.md`

## First useful agent task
Read `data/current_episode.txt`, then `data/episodes/{episodeId}/agent_inbox.md`.

If the inbox has `format-scenario` pending, read `format_request.md` and `scenario_raw.md`. Write the shot-block format into `scenario.md`. Do not create `shots/` folders. Then set `"status": "done"` in `format_request.json`.

Create shot folders only when the user asks, from an already formatted `scenario.md`. Prefer `POST /api/series/bootstrap` when the app is running, or follow `docs/AGENT_BOOTSTRAP.md`.

## User feedback
Before other stage work, read `data/episodes/{episodeId}/agent_inbox.md`. Each pending stage item points at `shots/{shotId}/{stage}/agent_request.md`.

- Rewrite that stage's `prompt.md` from the user message. The previous prompt is kept by the board in `prompt_history.json` when the file changes.
- The user message is in `agent_request.md` / `llm_task.md`. `prompt.md` is the exact text that goes to the model.
- Do not touch `llm_notes.md`, `status.json`, `stage_state.json`, `agent_dispatch.json`, the shot's `agent.json` (the shot's agent: provider and model), the shot's `notes.json` and `shot_settings.json`, `action.md` and `action.json`, or `data/descriptions/`. The board owns them: it clears the recommendation field when the request is sent and sets every stage status itself. Append a run note to `run_log.md` only if you ran a generation.
- Rebuild refs only when `refsChangedByUser` is false and the message means the references are wrong. When it is true, leave `refs/` untouched.
- Then write `agent_baseline.json` (`capturedAt`, `prompt`, `refsNote`, `workflowNote`, `refs` with `name`, `sha256`, `bytes`), set `agent_touch.json` to `{ "refsTouchedByUser": false }`, and set `"status": "done"` in `agent_request.json`.

## Shot watch

While this chat is open, check the current episode every 20 seconds.

- Read `data/current_episode.txt`, then `data/episodes/{episodeId}/agent_inbox.md`.
- Skip a shot when `shots/{shotId}/agent_watch.json` has `"stopped": true`, or when `shots/{shotId}/final_render/approve/` already has a file.
- If a stage request is `pending` and the shot is still open, accept it: rewrite that stage's `prompt.md` from the message in `agent_request.md`, append the note to `run_log.md` only if a generation was run, then set the request to `done`. A request with `cancelled` is skipped.
- If every shot is stopped or has a finished video, stop checking.
- Do not commit `data/`.

## First frame

A shot with no specific characters and no specific location is made directly in `shots/{shotId}/first_frame/`. Do not wait for `characters/approve` or `location/approve`, and do not create those stages. The rule is in `playbooks/stages/first_frame.en.md`, section «No character and no location».

## Characters stage

If the inbox item is `characters`, write only `prompt.md`. One section per character, heading `## <name>` in lowercase latin (`## lena`). An empty section means that character is not regenerated. The model playbook is `playbooks/models/qwen_outfit.en.md`.

The board runs ComfyUI, one job per character, into `output/`. Do not queue Comfy, do not edit the graph JSON, do not copy files into `approve/`. The user approves. Graph: `character_outfit_qwen21.json`, manifest `character_outfit`. Image 1 is the character base (`refs/{name}_base.*` if the user put it there, otherwise `data/characters/{name}/`). Image 2 is `refs/{name}_clothes.*` when the user placed that file. With only the base, node «image 2: clothing sample» is bypassed. Other files in `refs/` do not enter this graph. Set `"status": "done"` in `agent_request.json` when `prompt.md` is written. Do not write `status.json`.

## Do not
- Delete `output/` or `approve/` without explicit user confirmation. The trash button on a board file card in `output/` is that confirmation and the board deletes the file itself; an agent still never deletes from these folders on its own. In `refs/` the board has no trash: "Remove" only keeps a file out of this stage's graph (`run_settings.json` → `excluded`). Do not use excluded files, and do not delete or restore them
- Put playbooks inside a series folder; they are global
- Commit `data/`. Episodes, pictures, and secrets stay on the local disk

## Comfy Cloud
Some final workflows (`final_heygen`) run in Comfy Cloud and cost credits. Only the board sends them, and only after the user ticks "Allow a paid send to Comfy Cloud" on the stage page for that one run. An agent never calls cloud.comfy.org and never queues a job with `target: "cloud"` itself; it only writes `prompt.md`.

## Comfy queue
Any agent queues a run with the file `data/comfy_queue/<id>.json` (`status: pending`, `prompt` in ComfyUI API format, `uploads`, `saveTo` inside `data/`). The board process on the computer with ComfyUI sends it to ComfyUI (by default through the Comfy SDK and comfy-api-proxy at `http://127.0.0.1:8189/`; in `legacy` mode directly to `http://127.0.0.1:8188/`) and writes the result into the same file. Never call that address from a foreign shell.

## Task for any LLM
"Send to agent" writes `llm_task.md` into the stage folder. Claude, Cursor and a local Gemini read that file and carry it out. `git pull` is not needed for this task: the files are already on disk. ComfyUI is at `http://127.0.0.1:8188/` on the same computer as the project folder. Run commands from a local shell that sees this folder.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
