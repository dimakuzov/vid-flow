# Frameboard agent notes

This repo is a local-first board for structuring video generation.

## Important paths
- Series root: `data/series` (override with `SERIES_ROOT`)
- Global playbooks: `playbooks/`
- Bootstrap instructions: `docs/AGENT_BOOTSTRAP.md`

## First useful agent task
Read `data/series/scenario.md` and materialize shot/stage folders.
Prefer calling `POST /api/series/bootstrap` when the app is running, or create files directly using the contract in `docs/AGENT_BOOTSTRAP.md`.

## Do not
- Delete `output/` or `approve/` without explicit user confirmation
- Put playbooks inside a series folder; they are global
