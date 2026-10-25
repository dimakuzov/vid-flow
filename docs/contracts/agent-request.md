# Contract: the agent request and the provider

Types: `src/lib/contracts/agent-request.ts` (`AgentRequestFile`, `AgentProvider`, `AgentTask`, `AgentResult`, `AgentProviderInfo`).

## Decisions of the user (do not revisit)

- Only the board writes the stage status. The agent signals only `"status": "done"` in `agent_request.json`.
- Only `prompt.md` goes to the model. The recommendation (`llm_notes.md`) is cleared by the board when sending.
- The board itself calls the agent through a provider: Ollama (HTTP) or `claude -p` on the user's subscription. Manual mode (an agent in a separate chat reads the files) is the fallback.

## Request files in the stage folder

| File | What | Written by |
|---|---|---|
| `agent_request.json` | the request state (`AgentRequestFile`) | the board; a manual agent writes only `status: done` and optionally `suggestedWorkflow` |
| `llm_task.md` | **the only** task text, self-contained | the board, on send |
| `agent_dispatch.json` | the link between a request and a run: `workflow` (manifest id), `jobId` | the board |
| `agent_baseline.json`, `agent_touch.json` | a snapshot of refs for comparison | the board after text mode; the agent in agent/manual mode |
| `run_log.md` | the log: after every board run a block `## time · provider · model · mode · status` with the usage (`AgentResult.usage`: tokens in / cache write / cache read / out, cost at API prices, total time and model time, turns); in agent mode below it the CLI agent's output. The agent appends its own notes. The same usage is in `agent_request.json`, field `usage` | the board, the agent (appends) |

`agent_request.md` is an outdated copy of the task and may be removed in favor of `llm_task.md`. The episode's `agent_inbox.md` is only a table of contents of the `pending` requests for manual mode.

The request also stores `character` on the characters stage: the character the user had selected on the page. The task then says that the request is only about that character and that the sections of the others stay empty (`llm_task.md` and the text-mode task both get the line). If the name is not a character of the shot, it is ignored.

## Life cycle

```
"Send to agent" ──> pending ──provider text/agent──> running ──> done | error
                        │                                │
                        │ manual: the agent sets done ───┘
                        └──────────── "Cancel" ────────────> cancelled
```

| status | Set by | Fields |
|---|---|---|
| `pending` | `submitAgentRequest` | `createdAt`, `provider`, `mode`, `message` |
| `running` | the board's executor | `startedAt` |
| `done` | the board's executor (text/agent) or the agent (manual) | `finishedAt` (board), `suggestedWorkflow` |
| `error` | the board's executor / the background loop (timeout, restart) | `error`, `finishedAt` |
| `cancelled` | `cancelStage` | `finishedAt` |

All this time the stage phase (`stage_state.json`, `docs/contracts/stage-folder.md`) is `agent`. The background loop (`reconcileStage`) moves it:

- request `done` → `comfy` (the board queues a run with `agent_dispatch.workflow`, otherwise the stage choice) or `idle` (the agent ran ComfyUI itself: `agentRunsComfy`);
- request `error` → phase `error` with the text `request.error`;
- request `cancelled` → `idle`;
- `running` but no process in this board (the server was restarted) → `error` "the board was restarted while the agent worked";
- no answer for longer than the mode's timeout → `error`.

## Modes and providers

| Mode | When | What the board does |
|---|---|---|
| `text` | the stage has an available board workflow (`listWorkflowChoices` → `available`): location, first_frame, video | builds `AgentTask.system` (the model playbook of the selected workflow, the manifest's `playbook` field, plus the rule "return only the prompt text") and `user` (the message, the current `prompt.md`, the shot action from `shot.md`, the file names in `refs/`, the characters). One request to the LLM. The answer, without ``` fences, is written to `prompt.md` through `updateStageDocs` (prompt history), `agent_baseline.json` is updated, and `done` is set |
| `agent` | the stage has no board workflow (`characters`) or the user chose it | starts a CLI agent in the repo root with `llm_task.md`, writes the output to `run_log.md`; on process exit: 0 → `done`, otherwise `error` |
| `manual` | provider `manual` | starts nothing; the request waits for `done` from an agent in a chat |

| Provider | Modes | Call |
|---|---|---|
| `manual` | manual | none |
| `ollama` | text | `POST {FRAMEBOARD_OLLAMA_URL}/api/chat`, `stream: false`, model `FRAMEBOARD_OLLAMA_MODEL` |
| `claude` | text, agent | `claudeInvocation` in `providers.ts`. Both modes start in an empty folder outside the repository (`%TEMP%/frameboard-claude`: no `CLAUDE.md`, no `AGENTS.md`, no project memory), with `--strict-mcp-config` (no MCP servers) and `--no-session-persistence`. text: `--tools ""` (no tools), `--system-prompt` = the rules and the stage playbook, the task on stdin, the answer in `.result`: one request, one answer. agent: `--restricted` (no settings, file tools only in `--add-dir`), `--tools`/`--allowedTools Read,Write,Edit,Glob,Grep,Bash`, `--add-dir`: the shot folder, `playbooks/`, `data/comfy_queue/`, `docs/contracts/`, the stage's library (`data/characters/` or `data/locations/`); `--append-system-prompt` sets the frame "one stage of one shot". An error is the `result` field of the answer. The user's subscription, no API key |

If a provider cannot do the needed mode (for example `ollama` on `characters`), the request is an `error` at once with a clear text; the interface does not offer such a choice.

## Settings

| Variable | Default | What |
|---|---|---|
| `FRAMEBOARD_AGENT_PROVIDER` | `manual` | the default provider |
| `FRAMEBOARD_OLLAMA_URL` | `http://127.0.0.1:11434` | |
| `FRAMEBOARD_OLLAMA_MODEL` | none | without it `ollama` is unavailable |
| `FRAMEBOARD_CLAUDE_BIN` | `claude` | the path to the CLI |
| `FRAMEBOARD_AGENT_TEXT_TIMEOUT_MIN` | 5 | the text timeout |
| `FRAMEBOARD_AGENT_RUN_TIMEOUT_MIN` | 30 | the agent timeout |
| `FRAMEBOARD_AGENT_TIMEOUT_MIN` | 60 | the manual timeout |

## Cancel

The executor keeps an `AbortController` per request (by `request.id`) in the process memory. `cancelStage` marks the request `cancelled` and calls abort: the HTTP request to Ollama is cut, and the `claude` process is killed with its children. A result that arrives after the cancel is not written.

## API

| Method and path | Body / answer |
|---|---|
| `POST /api/episodes/{ep}/shots/{shot}/stages/{stage}/agent-request` | `{ message, character?, prompt, refs, workflow, runWorkflow?, provider?, model?, rememberForShot?, allowCloud?, takes? }` (`character` is the character selected on the characters page; `workflow` is the `workflow.md` note; `runWorkflow` is a manifest id; `videoWorkflow` is the old name; `rememberForShot: true` makes `provider`/`model` the shot's agent after an accepted request; `allowCloud: true` is the paid-send checkbox: the board runs the cloud workflow after the agent answers, once; `takes` is 1–8 files with the same prompt and different seeds, 1 if absent, always 1 for the final, not remembered between runs; stored in `agent_dispatch.json`). Answer `{ message, refsChangedByUser, stage: StageDetail }` |
| `POST .../stages/{stage}/cancel` | cancel (shared with the run) |
| `GET /api/episodes/{ep}/shots/{shot}/agent` | `{ agent: ShotAgent \| null, activity }`: the shot's agent and what it is doing |
| `PUT /api/episodes/{ep}/shots/{shot}/agent` | `{ provider, model? }`: "Save" in the shot agent menu. An unknown provider or model gives 400 |
| `POST /api/episodes/{ep}/shots/{shot}/next-stage` | `{ provider?, model? }`: the next unapproved stage by the shot's agent. Answer `{ started, skipped, assigned }` |
| `POST /api/episodes/{ep}/assign-agents` | `{ provider, model? }`: an agent for the shots that have none, starts nothing. Answer `{ started: [], skipped: [], assigned }` |
| `POST /api/episodes/{ep}/stages/{stage}/run-all` | `{ provider?, model?, redo? }`: an agent for the shots **without their own agent**, assigned to them; shots with an agent use theirs. Answer `{ started, skipped, assigned }` |
| `GET /api/agent/providers` | `AgentProviderInfo[]`: `id`, `label`, `modes`, `available`, `reason`, `isDefault` |
| `GET /api/agent/runs` | `{ running, queued }` across all episodes, see "Board agents in the CLI" |
| `POST /api/agent/runs/stop` | `{ episodeId, shotId, stageId }`, `{ episodeId, shotId }` (all stages of the shot), `{ episodeId, format: true }` or `{ all: true }`. Answer `{ stopped, running, queued }` |

`StageDetail.agentRequest` gives `status`, `provider`, `error`, `suggestedWorkflow` (the fields are already in `types.ts`). `StageDetail.shotAgent` is the shot's agent.

## The shot's agent

`shots/{shotId}/agent.json` → `{ provider, model, updatedAt }` (`model: null` means the provider's default model). **Only the board** writes it (`writeShotAgent` in `src/lib/series/shot-agent.ts`; the provider and model are checked as in a request). The agent does not touch the file.

- The agent itself starts nothing. A stage is started by "Send to agent" on the stage page and "▶ Every shot" above a stage column. Both use the shot's agent. For a shot without an agent, it is the agent chosen in the menu, and it is assigned to the shot. With no choice, `FRAMEBOARD_AGENT_PROVIDER` (otherwise manual), without assigning. The "Shot" column does not start a stage.
- "▶ Every shot" above a stage column assigns the choice to **all shots without an agent** (also those that will be skipped) and leaves shots that have an agent as they are. The menu asks for an agent only if there are such shots.
- The stage page: "Send to agent" takes the shot's agent by default; another choice goes for one run, and with the "remember" checkbox it becomes the shot's agent. For a shot without an agent the checkbox is on.
- `agent_request.json` stores who actually executed a run (`provider`, `model`).
- `ShotSummary.agent` is `{ provider, model } | null`; `ShotSummary.agentActivity` is `{ stageId, status: running | queued, since, provider } | null`: a running request of the shot's stages, otherwise a waiting one (`pending`, the stage in phase `agent` with that request, including manual: "waits for an agent in a chat").

## Board agents in the CLI

`GET /api/agent/runs` (`listAgentRuns` in `src/lib/series/agent-dispatch.ts`) shows what the board's providers are doing now. A list entry (`AgentRunEntry`): `kind` (`stage` or `format`, formatting a script), `episodeId`, `shotId`, `stageId` (`null` for `format`), `provider`, `model` (with no choice, the provider's default model), `since`.

- `running`: live runs of this board process: the executor (`listLiveAgentRuns` in `runner.ts`, without cancelled ones) and formatting (`isFormatRunLive`). `since` is `startedAt`.
- `queued`: `pending` for `ollama` / `claude` that the background loop will start when the provider has room (`providerParallel`): a stage in phase `agent` with the same request, plus `pending` formatting. `since` is `createdAt`.
- `manual` is not in the list: it is run by an agent in a chat, not by the board.

`POST /api/agent/runs/stop` (`stopAgentRuns`): body `{ episodeId, shotId, stageId }`, `{ episodeId, format: true }` or `{ all: true }`. For a stage it calls `cancelStage`, exactly what "Cancel" does on a stage. For script formatting it calls `abortFormatRun` (`src/lib/agent/format-runner.ts`): a live run gets an abort, a waiting one will not start, `format_request.json` becomes `error` with the text "Formatting stopped", and a model answer that arrives after the stop is not applied. `{ all: true }` stops all entries in both lists. A target with no board agent run is left alone (`stopped: []`). CLI: `npm run agents -- stop e01/format`.

Scripts without dependencies: `scripts/frameboard-status.mjs` is the Claude Code status line (timeout 500 ms, exit code always 0), and `scripts/frameboard-agents.mjs` is `npm run agents -- list | stop <ep>/<shot>/<stage> | stop --all`. The port is `FRAMEBOARD_PORT` (3456). Setup: the README, "Board agents in Claude Code".

## What the agent knows about a shot: notes, pictures, action

Code: `src/lib/series/shot-notes.ts`, `descriptions.ts`, `shot-action.ts`; the text for the agent is `src/lib/agent/shot-context.ts`. Only the board writes all these files.

| File | What | When |
|---|---|---|
| `shots/{shotId}/notes.json` | the user's notes to all stages of the shot: `{ entries: [{ id, at, stageId, message }] }` | `submitAgentRequest`, if the user wrote the message (a mass run with `auto: true` does not write it). To remove: `DELETE /api/episodes/{ep}/shots/{shot}/notes` `{ id }` |
| `data/descriptions/{sha256}.json` | what an approved picture really shows: `{ sha256, kind: location \| character \| first_frame, text, model, createdAt, source }` | the background loop `image-descriptions` (20 s, the current episode, at most 2 at once) and before a task to the agent. The key is the file content: one file in several shots is described once, and replacing a file in approve gives a new description |
| `shots/{shotId}/action.md`, `action.json` | the shot's action adapted to the approved pictures; `action.json` is `{ basis, textSha, source: agent \| user, at, model? }` | before a task to the agent on `first_frame`, `video_preview`, `final_render`, if the basis changed (shot.md, the pictures and their descriptions, the notes). An edit on the page is `PUT /api/episodes/{ep}/shots/{shot}/action` `{ text }`: the user's version, which wins over the model and goes into the next rebuild as a note; an empty text removes it |

A location description names the number of spaces, their rough size, the foreground, middle and background, openings and obstacles, where one can stand and how far the people will be, and the light. A first frame description adds the number of people, the pose, whether the face is visible and the rough share of the area taken by the face and the body, and the same facts about the place. The descriptions and the action are made by `claude -p` (`src/lib/agent/claude-oneshot.ts`): descriptions use `FRAMEBOARD_VISION_MODEL` (`claude-haiku-5-5` by default: only "what is in the picture"), the action uses `FRAMEBOARD_CONTEXT_MODEL` (`claude-sonnet-5-5` by default); an empty temporary folder, the picture is copied there and opened with the Read tool. `FRAMEBOARD_DESCRIBE=off` turns both off; with `FRAMEBOARD_LOOPS=off` (tests, scripts) the real claude is not called here. If it fails, the agent works with what it has.

In the agent's task (text and `llm_task.md`), after shot.md come: the action by the pictures, the picture descriptions (on the first frame without its own earlier approved variant), the shot's earlier notes (the current message is only the request) and the order of priority: the request → earlier notes (later wins) → what the pictures show → the action by the pictures → shot.md → the rest.

## Video: which workflow

The table "which choice when" is in the stage playbook (`playbooks/stages/video_preview.en.md`, `final_render.en.md`) and is repeated in the model playbook, which text mode already puts into the system prompt. If the selected choice is not from the table, the agent writes its id into `suggestedWorkflow`. The board shows the suggestion and does not switch.

The note that the final's prompt was taken from the preview's `prompt.md` and not from the video metadata is `sketchPromptTaskNote` (`src/lib/comfy/binding.ts`). `buildPrompt` appends it to the stage's `run_log.md` at run time.

## The stage model

`STAGE_CLAUDE_MODELS` in `src/lib/agent/config.ts`: Claude uses Haiku 5.5 by default, and on `first_frame` Sonnet, even if another model is assigned to the shot. A mass run takes it (`stageModel`), the stage page offers it by default (`AgentProviderInfo.stageModels`); another model chosen in the menu goes for one run. Formatting a raw script into the table uses Opus 5.5 by default (`FORMAT_CLAUDE_MODEL`). The picture descriptions are still written by Haiku (`FRAMEBOARD_VISION_MODEL`).

## `prompt.md` rules on the first frame, preview and final

Code: `GENERATION_PROMPT_RULES` in `src/lib/agent/task.ts` (text mode, in the system prompt before the playbook) and `renderPromptRules` in `src/lib/series/agent-request.ts` (the same text in `llm_task.md`). They are the same for all workflows of these three stages and win over the model playbook.

`prompt.md` is in English, with no Cyrillic; a spoken line is not translated into Russian. Before every new agent pass the lines are checked again against this request's `speech.md`: no lines are left in the prompt from an earlier `prompt.md` if the lines changed. People are `character1`, `character2`, `character3` in the order of the references (the list "Images the graph receives", otherwise the alphabet of the names from the characters line). The names from the message and shot.md do not go into the prompt: the user speaks to the agent with them. Each person gets one or two sentences and a binding to the pictures (`character1 is image 2 and the face from image 4`). The prompt is the whole instruction of this run: a request like "all good, add a package" is written by the agent into the full earlier text, not replaced with "do as before". Comparisons with the previous shot (`than before`, `much closer`, `as before`) are not sent by the board: "even closer" is rewritten as an absolute close-up.

## Manual mode

Manual mode stays: `AGENTS.md` briefly says where to get the task (`agent_inbox.md` → `llm_task.md`) and that the only signal is `done`.
