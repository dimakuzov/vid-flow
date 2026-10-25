English · [Русский](COMFY_SDK.ru.md)

# Comfy SDK as a second transport

The board can talk to ComfyUI and Comfy Cloud through the official `@comfyorg/sdk` (Comfy API v2) instead of direct HTTP calls. The `data/comfy_queue/<id>.json` format and the rules for agents do not change: the choice is made by `src/lib/comfy/transport.ts`, and the SDK implementation is `src/lib/comfy/sdk.ts`. The direct modules `client.ts` and `cloud.ts` stay, and they are the default.

Node 22+ is required. The package is in beta (checked against 0.5.0).

## Run locally (ComfyUI + comfy-api-proxy)

The SDK does not talk to ComfyUI on `:8188` directly, only through a proxy.

```bash
pip install comfy-api-proxy
comfy-api-proxy   # in front of ComfyUI; default port 8189, settings are in the package docs
```

```bash
COMFY_TRANSPORT=sdk COMFY_BASE_URL=http://127.0.0.1:8189 npm run dev
```

`COMFY_BASE_URL` defaults to `http://127.0.0.1:8189`. `COMFY_URL` is not used in this mode. The proxy needs no key: the board creates a local client without a key and does not pass it `COMFY_API_KEY` from the environment.

## Comfy Cloud

The key is the same: `COMFY_CLOUD_API_KEY` in `.env.local`. The cloud client is created with `apiKey`, and the `COMFY_BASE_URL` variable is cleared while it is created (for the SDK an empty address means Comfy Cloud). `COMFY_CLOUD_URL`, if set, points to another environment.

The rule from AGENTS.md stays: a paid run leaves only from the board, after the "Allow paid sending to Comfy Cloud" checkbox. There are no repeat sends.

## Switch in the board

In the header, to the right of EN/RU: "Direct" (direct calls) and "SDK". The choice is written to `data/comfy_transport.txt` and wins over `COMFY_TRANSPORT`; while the file does not exist, the variable applies. While any job has the `running` status, the buttons are locked and `POST /api/comfy/transport` answers 409: a job sent through one transport cannot be found by id through the other. Jobs with the `pending` status do not block switching.

## Checked on a real ComfyUI

On 2026-10-25 the board ran in SDK mode against `comfy-api-proxy` 0.1.6 in front of ComfyUI 0.41.0 (Windows, `@comfyorg/sdk` 0.5.0). These stages ran from start to finish and produced the expected files: the Krea 2 location, the Qwen Image 2.1 first frame (several uploaded pictures), the LTX 2.5 video preview (video with sound) and the MiniMax H3 video preview. Cancelling a running MiniMax H3 final emptied ComfyUI's queue and put the stage back to idle. Not checked: errors from a rejected graph, the Whisper text output path, and the paid cloud path.

## What the SDK cannot do, and how that shows in the board

- **Queue.** The SDK cannot read the shared queue (the list of waiting and running jobs), so in SDK mode `readComfyQueue()` throws, `queuePosition` stays `null` on jobs, and a "lost" job is not detected by timeout. If the service forgets a job, this will probably become a read error (`NotFound`); not checked live.
- **Cancel.** `job.cancel()` is documented only in the types; there is no wait signature in the docs. Cancel errors are swallowed, as before.
- **Text outputs.** The SDK does not return them: for a job with `PreviewAny` (Whisper in "Build project"), `outputs` is empty. The board takes the text from the ComfyUI history at `COMFY_URL` (the job id in the SDK equals the ComfyUI prompt_id), so in SDK mode ComfyUI on :8188 must be reachable directly for such jobs. Files go through the SDK. There is no such workaround for the cloud.
- **Output type.** `image` and `video` are taken. The board does not pick up `audio`, `file` or `latent`. How the SDK classifies the Continuity output (`mmc_video`) is not checked.
- **Node errors.** Parsing `node_errors` from the `details` of `InvalidWorkflow` is written to the ComfyUI format; the format of `details` in the SDK is not documented and was not checked with a live run.
- **File names.** Upload goes through `assets.fromBytes` (by hash), and the file name in the graph is replaced by a descriptor on submit. So the name substitution (`renameUploads`) is a no-op in this mode: the name stays as it was.
- **Cloud address.** `COMFY_CLOUD_URL` works through `COMFY_BASE_URL` inside the SDK.
