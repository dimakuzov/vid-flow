# Stage: video_preview

Low resolution: check the movement. The sketches are LTX 2.5 (the default) and MiniMax H3 Cinema. The board runs the graph.

The prompt follows the playbook of the selected variant (the `playbook` of its manifest): LTX — `playbooks/models/ltx_video.en.md`, MiniMax — `playbooks/models/minimax_h3.en.md`. `prompt.md` is always English.

## Variants

| Manifest id | order | Graph | Inputs |
| --- | --- | --- | --- |
| `video_ltx` | 5 | `ltx25_i2v_api.json` (LTX 2.5, 24 fps, with sound, 2–10 s) | the newest file in `first_frame/approve/`, `prompt.md` by `playbooks/models/ltx_video.en.md` |
| `video_minimax` | 6 | `minimax_h3_preview_api.json` (MiniMax H3 reference to video + Cinema LoRA, one pass at 0.5 MP, 24 fps, with sound, 2–10 s) | the newest file in `first_frame/approve/` as `<Picture 1>`, one picture per character (the face sheet, otherwise one face, otherwise the approved figure), `prompt.md` by `playbooks/models/minimax_h3.en.md` |

The board defaults to `video_ltx`. "▶ Every shot" over this stage runs two sketches on every shot, one after the other: LTX first, then MiniMax (`run_chain.json` in the stage folder). When the LTX run finishes, the board sends the agent the MiniMax step: the agent rewrites `prompt.md` in the MiniMax form and the board runs it. An error or "Cancel" stops the chain. The user approves one of the two videos; the final follows the approved one.

The user can also switch the variant in the menu and send to the agent with no message: the task then says that `prompt.md` was written for another workflow, and the agent rewrites it in the new form, keeping the action and the user's notes.

## Which variant

| Situation | Variant | Who decides |
| --- | --- | --- |
| Any shot | `video_ltx` | the board, the default |
| The likeness of faces matters most, or the speech must be very clean | `video_minimax` | the user in the menu, or the agent suggests |

An agent that sees the selected variant is not the row above writes its id in `suggestedWorkflow` of `agent_request.json` (`docs/contracts/agent-request.md`). The board shows the suggestion and does not switch by itself.

## What changes in the graph

Only what the manifest says: the first frame, `prompt.md` as is, the seed, the duration (the menu choice, otherwise `N sec` at the end of `prompt.md`; 2–10), the prefix `frameboard/video/{shotId}_ltx` or `_h3`. MiniMax also gets one picture per character. The negative, steps, CFG, LoRA and size come from the graph and do not change. With no number the duration is 4 seconds for LTX.

## Acceptance criteria

A good sketch:

- The first video frame matches the approved first frame: the same people, clothes, place. The picture is not stretched (the first frame is exactly 9:16).
- The main action from `shot.md` happens, and only that. No extra people, hands, or objects that move by themselves.
- The action fits the duration and ends in its end state instead of cutting off in the middle. If the action must stay unfinished (the braid is not finished), it is not finished.
- The camera does what is written: it stays, or makes one movement.
- The strength of the movement matches the text: “slight” is slight, not the maximum.
- The face and clothes hold for the whole length, no morphing.

Small sketch artifacts (noise, softness, low resolution) do not block acceptance: this is a movement preview. Reject when the movement itself is wrong.

## Do not

- Do not change more than one thing per round: the text, the duration, or the first frame.
