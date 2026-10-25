English · [Русский](README.ru.md)

# Frameboard

A local board for structuring video generation.

One project root is one series. The table shows the status of every shot, stage by stage:

`characters → location → first_frame → video_preview → final_render`

Files are the source of truth. The UI reads and writes the series directory, so if the interface fails you can work directly in the folders.

## Requirements

- Node.js 22 or newer and npm
- Python 3.10 or newer (only for `comfy-api-proxy`)
- git and ffmpeg on the `PATH`
- ComfyUI 0.41 or newer with the models and the one custom node pack listed in [ComfyUI models and nodes](#comfyui-models-and-nodes) (about 158 GB of models in total)
- A GPU with about 16 GB of VRAM (tested on an RTX 4070 Ti SUPER, Windows 11)
- Optional: Kdenlive or another editor for the final cut

## Run

The board sends jobs to ComfyUI through the official Comfy SDK, which talks to ComfyUI through `comfy-api-proxy`. Start ComfyUI first, then the proxy, then the board:

```bash
pip install comfy-api-proxy
comfy-api-proxy run        # in front of ComfyUI on :8188, listens on :8189

npm install
npm run dev
```

To skip the proxy and call ComfyUI directly, set `COMFY_TRANSPORT=legacy` or press "Direct" in the board header; see [docs/COMFY_SDK.md](docs/COMFY_SDK.md).

Open [http://127.0.0.1:3456](http://127.0.0.1:3456). `/` leads to the open episode (`data/current_episode.txt`), the episode table is `/e/{episodeId}`, a stage is `/e/{episodeId}/shots/{shotId}/{stage}`. The switch in the header changes the address and remembers the choice as the default episode.

One series per repository. Shared folders: `data/characters`, `data/locations`, `data/references`, `data/scenarios`. Episodes live in `data/episodes/<name>/`. Global playbooks are in `playbooks/`.

### Environment variables

| Variable | Default | What it does |
|---|---|---|
| `DATA_ROOT` | `data/` | data folder (use a temporary folder for trials) |
| `SERIES_ROOT` | — | folder of a single episode instead of `data/episodes/*` |
| `COMFY_TRANSPORT` | `sdk` | `sdk`: the official `@comfyorg/sdk` through comfy-api-proxy, see [docs/COMFY_SDK.md](docs/COMFY_SDK.md). `legacy`: direct HTTP calls (`COMFY_URL`, cloud.comfy.org) |
| `COMFY_BASE_URL` | `http://127.0.0.1:8189` | in `sdk` mode: comfy-api-proxy in front of your ComfyUI. A dead port (`http://127.0.0.1:9`) leaves jobs waiting in the queue and nothing goes to the GPU |
| `COMFY_URL` | `http://127.0.0.1:8188` | ComfyUI itself: used in `legacy` mode, and in `sdk` mode only to read text outputs such as Whisper |
| `COMFY_CLOUD_API_KEY` | — | Comfy Cloud key. Put it in `.env.local` in the project root, never in git |
| `FRAMEBOARD_AGENT_PROVIDER` | `manual` | who runs "Send to agent": `manual`, `ollama`, `claude` |
| `FRAMEBOARD_OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama |
| `FRAMEBOARD_OLLAMA_MODEL` | — | without it `ollama` is unavailable |
| `FRAMEBOARD_CLAUDE_BIN` | `claude` | path to the `claude` CLI (subscription, no API key) |
| `FRAMEBOARD_AGENT_TEXT_TIMEOUT_MIN` / `_RUN_TIMEOUT_MIN` / `_TIMEOUT_MIN` | 5 / 30 / 60 | timeouts for text, agent and manual mode |
| `FRAMEBOARD_LOOPS` | — | `off` turns off the background loops (tests) |

```bash
DATA_ROOT=/tmp/frameboard COMFY_BASE_URL=http://127.0.0.1:9 npx next dev -p 3466 -H 127.0.0.1
```

### Background loops

There is no separate worker. The ComfyUI queue (every 2 s) and the agent loop (every 3 s, all episodes) run inside the Next process: `src/instrumentation.ts` → `src/lib/background.ts`. While `npm run dev` is running, jobs go to ComfyUI on their own. `npm run comfy-queue` runs the queue without the board for debugging; do not run it together with `npm run dev`.

### Board agents in Claude Code

Agents started by the board (`claude -p`, Ollama requests) show in the Claude Code CLI status line: `Frameboard: 2 running · 3 queued`, `Frameboard: no agents` or `Frameboard: board is off`.

The status line is the `statusLine` field in `~/.claude/settings.json` ([docs](https://code.claude.com/docs/en/statusline)). Use forward slashes in the path (on Windows Claude Code runs the command through Git Bash):

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /path/to/frameboard/scripts/frameboard-status.mjs",
    "refreshInterval": 5
  }
}
```

`refreshInterval` is needed: without it the line only updates on session events, while board agents change when the session is quiet. If the board is not on 3456, add `FRAMEBOARD_PORT=3474 ` at the start of the command (that syntax is for Git Bash; without Git Bash Claude Code runs the command in PowerShell, where the variable cannot be set this way). Check:

```bash
echo '{}' | node scripts/frameboard-status.mjs
```

List and stop use the same API as the "Cancel" button:

```bash
npm run agents -- list
npm run agents -- stop e01/s03/location
npm run agents -- stop e01/format
npm run agents -- stop --all
```

In a Claude Code session, start with `!`: `! npm run agents -- list`. Or use the slash command `/agents list`, `/agents stop --all` (`.claude/commands/agents.md`). Script formatting (the "Add" button) is stopped as `e01/format`.

## ComfyUI models and nodes

The graphs in `playbooks/workflows/comfy/` need ComfyUI 0.41.0 or newer, one custom node pack and the model files listed in `models.json` (about 158 GB for all graphs together; one graph needs less). `requirements-nodes.txt` lists the node packs. Everything else the graphs use is built into ComfyUI.

```bash
# report what is missing in your ComfyUI folder (the one that holds main.py)
npm run comfy:install -- --comfy "C:\path\to\ComfyUI"

# download the missing models and clone the missing node packs
npm run comfy:install -- --comfy "C:\path\to\ComfyUI" --install
```

- It asks before downloading, skips files that are already complete, and resumes an interrupted download. Add `--only models` or `--only nodes` to do one part, `--yes` to skip the question, `--pip` to let it install a node pack's Python packages with ComfyUI's Python.
- `Lightricks/LTX-2.5` (the LTX files) is gated on Hugging Face: log in, accept the terms on the model page, create a read token and set `HF_TOKEN`. Civitai files need `CIVITAI_TOKEN`; two Civitai files have no direct link, and the script prints the page to download them from.
- Restart ComfyUI afterwards. Tested on ComfyUI 0.41.0 (Windows portable, 16 GB GPU).
- If an LTX run fails with `cannot access local variable '_buffers'` after a MiniMax run, free ComfyUI's models (the "Unload Models" button, or restart it) and run the stage again. This was seen once on 0.41.0 and the rerun worked.
- Every model and LoRA has its own license. Study each one before commercial use; see [NOTICE.md](NOTICE.md).

## What the board does

- a shot × stage table; on a phone, shot cards. Click a cell for a menu: upload, approve, pick a workflow, run, cancel, "Edit"
- a stage page: a status bar (phase and time, place in the ComfyUI queue, error text and node errors, "Cancel" / "Clear error"), a workflow menu from manifests, an agent suggestion with "Switch"
- `prompt.md` is exactly the text for the model; above it, the shot action from `shot.md`. Prompt version history with rollback
- "Send to agent": a recommendation, provider choice (remembered in the browser), request status. While the agent or ComfyUI works, the stage is locked
- fields are not overwritten by polling: if the file changed on disk while a field is being edited, a "pull in?" banner appears
- full-screen view of output with the prompt and seed from the ComfyUI PNG
- import of a script into shot folders (UI or agent)

Contracts between modules are in [`docs/contracts/`](docs/contracts/): stage folder and API, graph manifest, queue job, agent request.

## Order of the stages

A shot is built stage by stage, and a stage can run only when the stages it depends on have an approved file. Approve means: pick a result in `output/` and press "Approve selected"; the file moves to `approve/`.

1. **Characters.** Required whenever a character appears in the shot. Approve one picture of each character for this shot: either the library picture or an outfit edit made here (`lena_s01.png`). Without it the first frame stays unavailable ("Missing: Approved characters").
2. **Location.** Required for the first frame. Take the library location, or make a new one from text with Krea 2, and approve it. A shot that has characters but no location still needs this stage: the first frame stays unavailable until a location is approved ("Missing: Approved location").
3. **First frame.** Puts the approved characters into the approved location.
4. **Video (preview).** Animates the approved first frame (LTX 2.5 or MiniMax H3). Several previews can be tried; approve one.
5. **Final render.** Renders the approved preview again at higher quality.

A shot with no characters and no location skips stages 1 and 2 and is made directly in the first frame stage (`playbooks/stages/first_frame.en.md`, section "No character and no location").

## Demo episode

`examples/demo/` is a finished episode of three shots (location, first frame, preview and final video for each), with the prompt next to every result. Copy it and open it in the board to see how a shot is built; see [examples/README.md](examples/README.md).

## Series layout

```text
data/
  show.md
  current_episode.txt
  characters/          # library: {name}/portrait.png, side.png, full_body.png
  locations/           # library: {locationId}/ — general view
  references/          # shared series references
  scenarios/           # script documents
  episodes/
    e01/
      episode.md
      scenario_raw.md  # raw text for the agent
      scenario.md      # shots ## s01, read by the script
      format_request.md
      agent_inbox.md
      shots/
        s01/
          shot.md
          characters/
            refs/
            output/
            approve/
            prompt.md
            llm_notes.md
            refs.md
            workflow.md
            status.json
          location/
          first_frame/
          video_preview/
          final_render/
```

Character names in `approve`: `lena_s01.png`, `mark_s01.png`.

## Agent modes

"Send to agent" asks a language model to rewrite the stage prompt (`prompt.md`) from your note. The model is a helper, not a requirement: every `prompt.md` is a plain text field you can edit by hand in the board, and the board runs ComfyUI by itself. Choose the provider with `FRAMEBOARD_AGENT_PROVIDER` or in the stage menu.

| Provider | What it needs | What it does |
|---|---|---|
| `manual` (default) | Any chat agent that can read and write files in the project (Claude Code, Cursor, Gemini CLI and so on), or you | The board writes the task to `llm_task.md` and waits. The agent (or you) updates `prompt.md` and sets `"status": "done"` in `agent_request.json`. Nothing is called automatically |
| `ollama` | [Ollama](https://ollama.com) running locally and `FRAMEBOARD_OLLAMA_MODEL` set | Open-weights, fully local. Text mode only: rewrites `prompt.md` for stages that have a board workflow (location, first frame, video) |
| `claude` | The `claude` CLI ([Claude Code](https://claude.com/claude-code)) signed in with a subscription; no API key | Text mode, plus agent mode for stages without a board workflow (characters), where the CLI works in a scratch folder with the task file. Models: Haiku 5.5 by default, Sonnet 5.5 for the first frame, Opus 5.5 for formatting a raw script |

Two modes inside the board:

- **text**: the model returns only the new prompt. The board saves it and queues the ComfyUI job itself.
- **agent**: a CLI agent works through the task file, then the board continues.

Formatting a raw script into shots ("Send for formatting") also needs an agent. Without one, write `scenario.md` yourself in the shot-block format described in `docs/AGENT_BOOTSTRAP.md`.

Every stage runs a prompt that follows the rules in `playbooks/models/` (which words each model reads well, how to number the pictures, what to leave out). An agent writes that prompt for you from the shot text and the approved pictures, so plan on using one: `claude`, `ollama`, or a chat agent in `manual` mode.

If you have no model at all: skip "Send to agent" and write each `prompt.md` by hand, following those playbooks. The board then works as a file-based job queue and review table.

## Agent and playbooks

- Instructions for the agent that builds the structure: `docs/AGENT_BOOTSTRAP.md`
- Model and stage guides: `playbooks/`. The stage page shows the related files
- A shot character is an outfit edit of the library character from `data/characters/` against a sample in `refs/`: graph `playbooks/workflows/comfy/character_outfit_qwen21.json`
- Raw script: the "Send for formatting" button writes `scenario_raw.md` and a line in `agent_inbox.md`. An agent in Cursor formats it into `scenario.md`. "Create selected" is a separate script; it only creates folders from text that is already formatted

## Stack

Next.js + TypeScript + Tailwind + shadcn/ui.  
Series data is plain files on disk, no database required.

## License

MIT, see [LICENSE](LICENSE). You may use and sell this code commercially, but the copyright notice must stay with every copy, so the author is credited. The license covers only this repository's code. Frameboard runs no model itself: models and LoRAs are used through ComfyUI, which you install separately. Read the license of every model and LoRA you use, and the ComfyUI license, separately; see [NOTICE.md](NOTICE.md).
