# Contract: the ComfyUI queue job

Types: `src/lib/contracts/comfy-job.ts` (`ComfyJob`, `JobSummary`).

File: `data/comfy_queue/<id>.json`. `id`: Latin letters, digits, `.`, `_`, `-`, up to 81 characters. Next to it is a temporary `<id>.lock` (the pid of the process that is working with the job now).

## Fields and who writes them

| Field | Written by | When |
|---|---|---|
| `id`, `prompt`, `uploads`, `saveTo` | the one who queues (`queueStageRun`, an agent on `characters`, `POST /api/comfy/queue`) | when queued |
| `episodeId`, `shotId`, `stageId`, `workflow` | the board's queuer | when queued. Manual jobs may lack them |
| `status: pending`, `queuedAt` | `enqueueComfyJob` | when queued |
| `status: running`, `promptId`, `submittedAt` | the queue | ComfyUI accepted `POST /prompt` |
| `queuePosition` | the queue | on every pass over `GET /queue`: 0 is executing, 1.. is waiting; `null` is unknown. In SDK mode it stays `null` (the SDK cannot read the shared queue) |
| `lostAt`, `restarts` | the queue | ComfyUI answers but the job is neither in its queue nor in its history (ComfyUI or the computer was restarted): `lostAt` is since when. After a minute the job is `pending` again without `promptId`, `restarts` + 1, and the next pass sends it again. After two retries it is `error`. While ComfyUI does not answer, the job waits |
| `status: done`, `files`, `finishedAt` | the queue | the files are downloaded into `saveTo` |
| `status: error`, `error`, `nodeErrors`, `finishedAt` | the queue | ComfyUI refused or failed |
| `status: cancelled`, `finishedAt` | `cancelComfyJob` ("Cancel" button) | at any moment before `done/error` |
| `updatedAt` | any writer | on every write |

Nobody except those listed changes the file. The stage (`stage_state.json`) refers to the job by `jobId`; the queue does not write the stage status.

## Statuses

```
pending ──claim──> running (no promptId) ──POST /prompt──> running (promptId) ──history──> done
   ^                    │ ComfyUI unavailable                    │ refusal / failure
   └────────────────────┘                                         └──────────────────────> error
pending / running ──"Cancel"──> cancelled   (the prompt is removed from ComfyUI: /queue delete, /interrupt)
```

- ComfyUI is off: the job stays `pending` without an error. The stage shows "Waiting in the queue".
- `cancelled` is final: the queue rereads the file before and after `POST /prompt` and does not overwrite a cancel (test `src/lib/comfy/queue.test.ts`).
- `running` without `promptId` for longer than 20 minutes with a dead `.lock` is taken into work again.

## `uploads` and `saveTo`

- Paths are from the cwd (the repo root) and must lie inside `data/` or `playbooks/` (uploads) and inside `data/` (`saveTo`). Otherwise the job is not queued.
- `uploads[].filename` is the name in ComfyUI (`/upload/image`, `overwrite: true`).

## Result files

- `saveText: true` also saves the text outputs of nodes (`outputs[node].text`, for example `PreviewAny`) as `{node}.txt` (a local ComfyUI only). Needed for graphs without pictures: Whisper speech recognition for the post stage (`docs/contracts/post.md`).
- Files are saved into `saveTo` byte for byte (no re-encoding): a PNG keeps the workflow and seed metadata.
- **Names are unique**: an existing file in `saveTo` is not overwritten; on a clash a suffix is added. The final names are in `files`.

## Errors

`error` is one line for the user. `nodeErrors` are per node: `{ node, classType, message }`, human text (from `node_errors[...].errors[].message/details`), not JSON.

## What the interface sees

`StageDetail.job: JobSummary | null` is the stage's latest job (`stage_state.jobId`), read by `readJobSummary()` without writing. Fields: `status`, `workflow`, `queuedAt`, `submittedAt`, `finishedAt`, `queuePosition`, `files`, `error`, `nodeErrors`.

Take the cell phase from `StageDetail.state.phase` / `StageSummary.status`, not from `job.status`: `running` without `submittedAt` means the queue is only trying to send, which for the user is still "Waiting in the queue".

## The process

The queue and the agent loop run inside the Next process (`src/instrumentation.ts` → `src/lib/background.ts`, one timer per name, hot reload replaces the loop function). There is no separate worker. `npm run comfy-queue` is a debug run of the same queue without the board; do not run it together with `npm run dev` (it will not break because of `.lock`, but two processes poll ComfyUI). `FRAMEBOARD_LOOPS=off` turns the loops off (tests).

How the queue reaches ComfyUI is chosen by the transport (`docs/COMFY_SDK.md`): by default the official SDK through `comfy-api-proxy` (`COMFY_BASE_URL`, `http://127.0.0.1:8189`), or with `COMFY_TRANSPORT=legacy` direct calls to ComfyUI at `COMFY_URL` (`http://127.0.0.1:8188` by default).

## Comfy Cloud (`target: "cloud"`)

A job with `target: "cloud"` is sent by the queue not to the local ComfyUI but to Comfy Cloud (`https://cloud.comfy.org`, API v1, the key `COMFY_CLOUD_API_KEY` from `.env.local`; `COMFY_CLOUD_URL` is another address, for tests).

- Sending: `POST /api/upload/image` for every file of `uploads` → the cloud name is substituted into all graph inputs with that name → `POST /api/prompt` with `extra_data.api_key_comfy_org` (paid nodes). `promptId` is the job id in the cloud.
- Polling: `GET /api/jobs/{id}` not more often than every 15 s. `completed` → the files from `outputs` are downloaded through `GET /api/view` (302 to a signed link; the link needs no key) into `saveTo`. `failed` → `error`. A network failure while polling or downloading is not an error: we ask again, the run is already paid for.
- **There is no resend.** Any error before the answer of `/api/prompt` is `error`. A `running` job without `promptId` (the board fell over in the middle of sending) is `error` "Sending was interrupted… check cloud.comfy.org": credits may have been charged already, and the user decides.
- "Cancel" removes the job from the cloud queue and interrupts it, only if that very job is the one executing.
