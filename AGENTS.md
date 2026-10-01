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

- Rewrite that stage's `prompt.md` from the user message.
- Rebuild refs only when `refsChangedByUser` is false and the message means the references are wrong. When it is true, leave `refs/` untouched.
- Then write `agent_baseline.json` (`capturedAt`, `prompt`, `refsNote`, `workflowNote`, `refs` with `name`, `sha256`, `bytes`), set `agent_touch.json` to `{ "refsTouchedByUser": false }`, and set `"status": "done"` in `agent_request.json`.

## Do not
- Delete `output/` or `approve/` without explicit user confirmation
- Put playbooks inside a series folder; they are global

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
