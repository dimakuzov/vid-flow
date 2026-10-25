# Demo episode

`demo/` is a data folder for the board: one episode of three shots, already built and approved on every stage, so you can see what the board produces and how.

| Shot | Stages | Models |
| --- | --- | --- |
| `s01` Lena's dream: the door | location from text, first frame, video preview, final | Krea 2, Qwen Image 2.1, LTX 2.5 |
| `s02` Lena's dream: the darkroom | location from text, first frame, video preview, final | Krea 2, Qwen Image 2.1, LTX 2.5 |
| `s03` Waking up | outfit edit, first frame on a photo of the bed, video preview with a spoken line, final | Qwen Image 2.1, MiniMax H3 (Cinema LoRA) |

Every stage folder holds the approved result (`approve/`) and the exact text sent to the model (`prompt.md`), so the prompts are there to read next to the pictures they made. The character `Lena` and the location `Lena_Room` are in `characters/` and `locations/`; the character is fictional.

## Look at it

Work on a copy, because the board writes its own state files into the data folder:

```bash
cp -r examples/demo my-demo          # on Windows: xcopy /E /I examples\demo my-demo
DATA_ROOT=my-demo npm run dev        # then open http://127.0.0.1:3456
```

In PowerShell set the variable first: `$env:DATA_ROOT = "my-demo"; npm run dev`.

Open the table `/e/e01`, then any cell to see the prompt, the references that went into the graph and the result. Nothing is generated while you look.

## Make it again

Open a stage in your copy, change `prompt.md` if you like and run the stage again: the new variant appears in `output/` next to the approved one. This needs ComfyUI with the models from `models.json` (see the main README) and, for the prompts, an agent or your own hands (see "Agent modes"). On an RTX 4070 Ti SUPER (16 GB) the stages took: location about 20 s, first frame about 50 s, LTX 2.5 preview or final about 1 minute, MiniMax H3 preview about 2 minutes, MiniMax H3 final about 6 minutes.

The pictures and videos were generated with the models listed in `models.json`. Each model and LoRA has its own license; see `NOTICE.md`.
