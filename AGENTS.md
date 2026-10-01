# Frameboard agent notes

This repo is a local-first board for structuring video generation.

## Important paths
- One series for the whole project. Shared libraries: `data/characters/{name}/`, `data/locations/{locationId}/`, `data/references/` (shared pictures), `data/scenarios/` (scenario documents)
- `data/scenarios/` is the document library. The board still reads the working cut from `data/episodes/{episodeId}/scenario.md`
- Episodes: `data/episodes/{episodeId}/`. Current episode id: `data/current_episode.txt`
- `DATA_ROOT` overrides the `data/` directory. `SERIES_ROOT` overrides the current episode directory
- Shot variants stay in `data/episodes/{episodeId}/shots/sXX/` and are built from those libraries
- Global playbooks: `playbooks/`
- Character Comfy graph: `playbooks/workflows/comfy/character_pose_outfit_qwen.json`
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
- Do not append the run log to `llm_notes.md`. That file is only the user's next recommendation. Append the run note to `run_log.md`.
- Rebuild refs only when `refsChangedByUser` is false and the message means the references are wrong. When it is true, leave `refs/` untouched.
- Then write `agent_baseline.json` (`capturedAt`, `prompt`, `refsNote`, `workflowNote`, `refs` with `name`, `sha256`, `bytes`), set `agent_touch.json` to `{ "refsTouchedByUser": false }`, and set `"status": "done"` in `agent_request.json`.

## Shot watch

While this chat is open, check the current episode every 20 seconds.

- Read `data/current_episode.txt`, then `data/episodes/{episodeId}/agent_inbox.md`.
- Skip a shot when `shots/{shotId}/agent_watch.json` has `"stopped": true`, or when `shots/{shotId}/final_render/approve/` already has a file.
- If a stage request is `pending` and the shot is still open, accept it: rewrite that stage's `prompt.md` from the recommendation, leave the previous prompt in `prompt_history.json`, clear `llm_notes.md`, append the note to `run_log.md` only if a generation was run, then set the request to `done`.
- If every shot is stopped or has a finished video, stop checking.
- Do not commit `data/`.

## Characters stage

If the inbox item is `characters`, the paperwork above is not the result. Run ComfyUI with the command in `playbooks/workflows/characters_comfy.md` (English: `playbooks/workflows/characters_comfy.en.md`). Claude follows the same section.

ComfyUI is at `http://127.0.0.1:8188`. Do not edit the graph JSON. Do not run `update_comfyui.bat`. Set the stage `status.json` to `done` only when every character in the shot has `approve/{name}_{shotId}.png` and the clothes on it match the user message.

## Do not
- Delete `output/` or `approve/` without explicit user confirmation
- Put playbooks inside a series folder; they are global
- Commit `data/`. Episodes, pictures, and secrets stay on the local disk

## Agent mail
Cloud and local agents share this git branch, not the `data/` folder. Branch: `cursor/episode-folders-7482`.

- Cloud writes only `agent-mail/cloud-to-local.md`
- Local writes only `agent-mail/local-to-cloud.md`
- Before reading, `git pull`. Reply by appending a block to your own file, then commit and push only `agent-mail/`
- Do not edit the other side's file

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
