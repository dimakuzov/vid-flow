# Instructions for the agent: the episode and the shot structure

One series per repository. The agent works with files, and the board does not start the agent by itself.

## Context
- Shared libraries: `data/characters/{name}/`, `data/locations/{locationId}/`
- Shared series references: `data/references/`. They are not a shot's `refs/`
- Script documents: `data/scenarios/`. The working text of the current episode is still `data/episodes/{episodeId}/scenario.md`
- Episodes: `data/episodes/{episodeId}/`
- Current episode: `data/current_episode.txt`
- Raw script: `data/episodes/{episodeId}/scenario_raw.md`
- Formatted script: `data/episodes/{episodeId}/scenario.md`
- Inbox: `data/episodes/{episodeId}/agent_inbox.md`
- Global playbooks: `playbooks/`
- The stages of every shot: `characters`, `location`, `first_frame`, `video_preview`, `final_render`
- Stage folders: `refs/`, `output/`, `approve/`
- Stage documents: `prompt.md`, `llm_notes.md`, `refs.md`, `workflow.md`, `status.json`
- `workflow.md` is an optional note for a shot. It can stay empty. The graph choice is not set there.
- `llm_notes.md` is the recommendation input field on the board. The "Send to agent" button moves the text into `agent_request.md`/`llm_task.md`, writes a line into the episode's `agent_inbox.md` and clears the field. The agent does not touch `llm_notes.md`, `status.json` or `stage_state.json`: the board owns them. The run log is `run_log.md`. Earlier prompt texts are in `prompt_history.json` and can be restored from the stage.
- `prompt.md` is exactly the text that goes to the model.

## Raw script
If the inbox has a `format-scenario` item with the status `pending`:

1. Read `format_request.md` and `scenario_raw.md` of the current episode.
2. Write `scenario.md` as shot blocks. Do not invent the plot.
3. Do not create the `shots/` folders.
4. Set `"status": "done"` in `format_request.json`.

Format:

```md
# Episode title

## s01 Shot title
- characters: lena, mark
- location: night_cafe
- duration: 6
- speech: Lena: You are late.
The action text.
```

`duration` is the clip length, 2–12 seconds. `speech` is a line word for word, one per row; if nobody speaks there are no such rows. When the board creates the shots it puts the lines into `shots/{shotId}/speech.md` and the duration into the video stage's duration choice. The full rules are `FORMAT_RULES` in `src/lib/series/format-request.ts` (the formatting model gets the same).

## Identity libraries
A shot's character and location are built from the shared libraries, not from scratch:

- `data/characters/{name}/`: the base is `full_body.png`, then `body.png`, then `{name}_body.png`, otherwise the first picture; also `portrait.png`, `side.png` and a face sheet (`{name}_face_sheet.png`)
- `data/locations/{locationId}/`: `view.png` and `description.txt`

The names of the character and location are as in the episode's `scenario.md`. These folders do not replace the stages `data/episodes/{episodeId}/shots/sXX/characters` and `.../location`.

A shot's approved character: `shots/{shotId}/characters/approve/{name}_{shotId}.png`. There is no separate `env/` folder.

Before filling in a stage, read the playbook:

- character: `playbooks/stages/characters.en.md`, `playbooks/models/qwen_image.en.md`, `playbooks/workflows/characters_comfy.en.md`
- location: `playbooks/stages/location.en.md`, `playbooks/models/krea2_location.en.md`
- first frame: `playbooks/stages/first_frame.en.md`, `playbooks/models/qwen_first_frame.en.md`, `playbooks/workflows/first_frame_comfy.en.md`

## Build the shot folders
This is a separate step after formatting. Read the current episode's `scenario.md`.

1. Parse all shots (`s01`, `s02`, ...).
2. For every shot create `data/episodes/{episodeId}/shots/{shotId}/shot.md`.
3. For every stage create the folders `refs`, `output`, `approve` and the stage documents.
4. Do not overwrite existing files in `output/` and `approve/` without the user's explicit confirmation.
5. The names of approved characters: `{character}_{shotId}.ext`.

The "Create selected" button does the same with a script inside the board. It does not call the agent. If the text has no `## s01` headings, the script creates no folders.

## Alternative through the app's API
If the dev server is running:

```bash
curl -X POST http://127.0.0.1:3456/api/series/bootstrap \
  -H 'content-type: application/json' \
  -d '{"episodeId":"e01","shotIds":["s01","s02","s03"]}'
```

Or through the UI: the "Episode and script" block on the main page.
