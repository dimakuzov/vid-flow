# Frameboard agent notes

This repo is a local-first board for structuring video generation.

## Important paths
- Series root: `data/series` (override with `SERIES_ROOT`)
- Identity libraries: `data/series/characters/{name}/`, `data/series/locations/{locationId}/`
- Shot variants stay in `data/series/shots/sXX/` and are built from those libraries
- Global playbooks: `playbooks/`
- Character Comfy graph: `playbooks/workflows/comfy/character_pose_outfit_qwen.json`
- Location Comfy graph: `playbooks/workflows/comfy/location_views_multiple_angles.json`
- Bootstrap instructions: `docs/AGENT_BOOTSTRAP.md`

## First useful agent task
Read `data/series/scenario.md` and materialize shot/stage folders.
Prefer calling `POST /api/series/bootstrap` when the app is running, or create files directly using the contract in `docs/AGENT_BOOTSTRAP.md`.

## User feedback
Before other stage work, read `data/series/agent_inbox.md`. Each pending item points at `shots/{shotId}/{stage}/agent_request.md`.

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
