# Video prompts: fixes from episode 9

Source: `episode_9`, all 15 shots, `video_preview` and `final_render`, read only. Notes come from `notes.json`, versions from `prompt_history.json`, runs from `data/comfy_queue`. The videos themselves were not watched.

**Numbers.** Preview: 51 runs, 13 notes. About 30 of the runs are «▶ All shots», which runs LTX and then MiniMax on every shot (7 MiniMax runs cancelled). Final: 29 runs, 10 notes, 9 of 15 shots approved on the first final run. Shots whose preview was H3: 6 shots, 7 final runs, 1 note. Shots whose preview was LTX: 7 shots, 17 final runs, 6 notes.

Each block: where the text lives, the exact current text, the replacement, the shots it comes from. Texts are English only. All of V1–V7 are applied to the `.en.md` playbooks, `ACTION_RULES` and `GENERATION_PROMPT_RULES`, at the user's request. The Russian playbooks `ltx_video.md` and `minimax_h3.md` were not updated: the user does not need them, and the models never read them.

## V1. A person who should stand still starts moving

Shots: `s02` final, three notes in a row: «Lena does not wave», «Lena does not walk up to Misha», «Lena goes nowhere, remove every mention of her moving». `s02` preview: «Lena does not wave her arms». The prompt placed her with route words (`Halfway down the path`, `Far down the walkway`) and kept the scenario gesture (`gives a small dismissive flick of one hand`).

**`playbooks/models/ltx_video.en.md`, «What the model reads», item 4.**

Was:
> 4. **Describe the action.** What starts, what changes, what it settles into. Order it in words — `initially`, `a moment later`, `simultaneously` — not by timestamps. One sustained action reads better than four crowded ones.

Becomes (V2 and V3 extend the same item, see below for the full text):
> 4. **Describe the action.** What starts, what changes, what it settles into. One sustained action reads better than four crowded ones. Every person who has no action in the shot gets one sentence that holds them: `the woman in the black leather jacket stands on the same spot until the end of the shot, her arms at her sides`. Give a standing person's place as a spot next to something in the frame (`beside the bench on the right`), not as a part of a route (`halfway down the path`, `far down the walkway`): route words make the model walk them.

**`playbooks/models/minimax_h3.en.md`, section 3, item 2.**

Was:
> 2. **The start is `<Picture 1>`.** Describe the positions, poses and gaze as they are in the first frame; the action continues from there.

Becomes:
> 2. **The start is `<Picture 1>`.** Describe the positions, poses and gaze as they are in the first frame; the action continues from there. Every person who has no action in the shot gets one sentence that holds them: `<Subject 1> stands on the same spot until the end of the shot, her arms at her sides`. A standing person's place is a spot next to something in the frame, not a part of a route.

**`ACTION_RULES` in `src/lib/series/shot-action.ts`.** Add after `- Do not invent movements, gestures or emotions that neither the scenario nor the notes give.`:
> - A person with no action in the scenario or the notes stays on their spot for the whole shot. Say so in one short clause. A gesture from the scenario (waving, spreading the arms) stays only when it is the point of the shot.

## V2. The action starts late

Shots: `s06` preview, four notes: «she goes left», «turns left at once, still on the stairs», «leaves the frame at the end», «goes left at once, along the wall». `s03` final: «Misha leaves at once!». `s09` final: «she stands up right after her line». The prompts open the action with `Initially she stands upright…`, `She steps down the last steps…`, `Then she turns…`, and the model spends half the clip on the first part.

**`playbooks/models/ltx_video.en.md`, item 4**, continue the text from V1:
> The main movement starts at the opening moment: write it right after the opening image, with `at once`, `from the first moment`, `right after the line`. Do not open the action with a pause or a preparatory step (`Initially she stands upright, then…`) unless the shot is about that pause. Order the rest in words — `a moment later`, `simultaneously`, `by the end` — not by timestamps. When someone must leave the frame, say where and that they are out of it before the end: `she passes the left edge of the frame and is gone, the steps empty`.

**`playbooks/models/minimax_h3.en.md`, section 3, item 4.**

Was:
> 4. **Timing**: `for one second, then…`, `at the same moment…`, `only at the very end…`. The action fills the duration; the last line says how the shot ends: `until the end of the shot both stay seated`.

Becomes:
> 4. **Timing**: `for one second, then…`, `at the same moment…`, `only at the very end…`. The main movement starts within the first second unless the shot is about a pause. A reaction to a line starts right after the line: `right after her line she stands up`. The action fills the duration; the last line says how the shot ends: `until the end of the shot both stay seated`.

## V3. Two people move and their pace is not given

Shots: `s01` final, two notes: «Misha walks slower than Lena, he falls behind», «he does not run after her, the gap grows the whole time». The preview prompt had `his stride quick as he closes the gap`, which the scenario does not say.

**`playbooks/models/ltx_video.en.md`, item 4**, continue the text from V2:
> When two people move, give each one their pace and say how the distance between them changes: `she walks briskly toward the door; he follows at a slow walk, and the gap between them grows the whole time`. Do not add catching up, closing the gap or walking side by side unless the task says so.

**`playbooks/models/minimax_h3.en.md`, section 3**, new item after item 5:
> 6. **Two people moving**: each one's pace and how the distance between them changes: `<Subject 2> follows at a slow walk, and the gap between them grows until the end`.

(The current item 6 «Light» becomes item 7.)

**`ACTION_RULES`**, add after the V1 line:
> - When two people move, say who is faster and whether the distance between them grows or shrinks. Do not make one catch up with the other unless the scenario or a note says so.

## V4. A new note leaves the old sentence that contradicts it

Shots: `s09` final: the user asked «she stands up at the end» twice; the prompt kept `character1 keeps her guarded gaze on character2 and does not rise` from the preview. `s02` final: the old sentences about where Lena is stayed until «remove every mention of her moving».

**`GENERATION_PROMPT_RULES` in `src/lib/agent/task.ts`, last paragraph.**

Was:
> When the user asks for one change, rebuild prompt.md from the playbook template: keep the lines that still serve the shot and the user's notes, put the change into the line it belongs to, and leave out lines that no longer serve. Every idea appears once.

Becomes:
> When the user asks for one change, rebuild prompt.md from the playbook template: keep the lines that still serve the shot and the user's notes, put the change into the line it belongs to, and leave out lines that no longer serve. Every idea appears once. Before writing, find every sentence of the current prompt.md that says the opposite of the new note or keeps the old state (`does not rise` when the note asks her to stand up; a walking line when the note says she stays) and take it out. The final prompt.md says each person's state once, as the note wants it.

## V5. Emotion and gestures come out stronger than wanted

Shots: `s11` preview: `Her head snaps up sharply from the notebook, her eyes lit with fanatical certainty, and she holds a dramatic pause` → note «less emotional, she talks to herself». `s02` preview: «Lena does not wave her arms». The H3 playbook has a table for this; the LTX playbook does not.

**`playbooks/models/ltx_video.en.md`, «What the model reads», item 3.**

Was:
> Emotion is a physical cue — a jaw tightening, a hand hesitating — never an abstract label.

Becomes:
> Emotion is one small physical cue at natural strength — a jaw tightening, a hand hesitating — never an abstract label. Scenario words like `fanatical`, `dramatic`, `in a panic`, `sharply` become a quiet cue, not a bigger movement: `she looks up from the notebook, her eyes certain`. A gesture is written only when the scenario or a note names it.

**`playbooks/models/ltx_video.en.md`**, new section after «Sound», the same idea as the H3 table:

> ## Words that make the model overdo it
>
> | Word in the text | What the model does | Write instead |
> | --- | --- | --- |
> | snaps, sharply, abruptly, jerks | a jolt of the whole body | turns, lifts, at an even pace |
> | hurries, frantic, in a panic | runs, flails | a brisk, steady walk |
> | dramatic pause, fanatical, theatrical | stage acting, big faces | one small cue on the face |
> | spreads her arms, waves, gestures | waves the arms for the whole clip | hands at her sides, unless a gesture is the point |
> | appears, emerges, materialises | a second copy of the person, a figure out of nowhere | walks in from the left edge of the frame |

## V6. The scene drifts: light, extra people, camera

Shots: `s03` final: «the surroundings do not change, no brighter or darker, only one person in the video». `s04` final: «only one sweeper», the prompt had `a street sweeper … gradually appears`. `s13` final: the camera moved in and the place changed («do not change the location»).

**`playbooks/models/ltx_video.en.md`, «First frame (preview and final)»**, add at the end of the first paragraph:

> The light and the weather stay as in the frame for the whole clip unless the task changes them. A person who is not in the frame enters it on foot from an edge (`walks in from the left edge of the frame`); never write that someone appears. The number of people in the frame at the end is the number the task gives; say it in the last sentence when someone enters or leaves: `he is the only person in the courtyard`.

**`playbooks/models/ltx_video.en.md`, item 5**, add at the end:

> Without a camera move in the task, the shot is static from the first word to the last: write no push-in, drift or zoom.

## V7. Gaze into the lens by default

The same rule as P1 on the first frame. `s12`: the scenario says «lifts her head and freezes», the prompt wrote `looks straight into the lens` in both the preview and the final. `s01` final v1–v3: `looking into the lens`, carried over from the first frame prompt.

**`ACTION_RULES`**, add after the V3 line:

> - Nobody looks at the camera unless the scenario or a note says so. Two people who talk look at each other. A person who walks looks ahead, where they are going.

**`playbooks/models/ltx_video.en.md`, item 3**, add after the V5 text:

> Give every gaze a target in the frame (`looks at the man in the blue jacket`, `looks ahead along the path`). Nobody looks into the lens unless the task says so.

**`playbooks/models/minimax_h3.en.md`, section 3, item 5.**

Was:
> 5. **Gaze with a target**: `looks along the path at the far lamp post`, `looks at <Subject 2>`.

Becomes:
> 5. **Gaze with a target**: `looks along the path at the far lamp post`, `looks at <Subject 2>`. Nobody looks into the lens unless the task says so; people who talk look at each other.

## Not a prompt fix: which workflow first

«▶ All shots» runs LTX and then MiniMax on every shot (`minimax_h3.en.md`, section 6), so every shot costs two preview runs before the first note. In this episode the H3 branch needed far fewer final runs. A possible board change: for shots with speech or with two people, run only `video_minimax` in «▶ All shots». This is a workflow choice for the user, not a prompt rule.

## Russian playbooks

The models never get the Russian files: every manifest points to `.en.md`, `resolvePlaybook` in `task.ts` takes `.en.md` first, and every `.en.md` exists. The Russian files are not only for the user, though. Agents are pointed at them by path:

- `AGENTS.md`: «First frame» points to `playbooks/stages/first_frame.md`, section «Без персонажа и локации». Chat agents read `AGENTS.md`.
- `src/lib/series/bootstrap.ts` writes `See playbooks/stages/first_frame.md` into every first-frame `refs.md`, and the agent task includes `refs.md`.
- `src/lib/series/agent-request.ts` falls back to `${stageId}.md` when `.en.md` is missing; `src/lib/series/scanner.ts` lists both files on the stage page.
- Every `.en.md` except `image_edit.en.md` opens with «Russian original: …», and the round rules require a change in both files.

Deleting the Russian files means changing those pointers first: `AGENTS.md`, `bootstrap.ts` (only new shots; the existing `refs.md` files in `data/` keep the old path), `scanner.ts`, `agent-request.ts`, the `.en.md` headers and `playbooks/README.md`. Brief branches that edit Russian playbooks would get modify/delete conflicts. Nothing was deleted.
