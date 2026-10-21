# MiniMax H3 Cinema (video preview and final render): how to write the prompt

English copy for the agent. Russian original: `playbooks/models/minimax_h3.md`.

Two variants use this playbook: `video_minimax` on the video preview (graph `minimax_h3_preview_api.json`, one pass at 0.5 MP) and `final_h3_cinema` on the final render (graph `minimax_h3_cinema_api.json`, a second pass with the latent upscale to 1.5 MP). Both are MiniMax H3 **reference to video** with the Cinema LoRA. There is no video reference: the model gets the approved first frame, one picture per character and the text. All the motion comes from the text. The user chose this graph because it keeps the quality and the likeness of the people stable; the old H3 graph with the low-res video as a reference often failed.

---

## 1. What the model gets

| Label | What | From |
| --- | --- | --- |
| `<Picture 1>` | the approved first frame: the place, the camera, the people in their clothes | `first_frame/approve/` (newest) |
| `<Picture 2>`, `<Picture 3>`, … | one picture per character, in the order of the task list: the face sheet (several views of the same face on one picture), otherwise one face, otherwise the approved figure | this stage's `refs/` (`{name}_face_sheet`, then `{name}_face`), otherwise the library (`*face_sheet*`, then the portrait), otherwise `characters/approve/` |
| duration | preview: the stage menu (otherwise `N sec` in `prompt.md`); final: the length of the approved preview | the board |
| the text | `prompt.md`, as written | this stage |

The task lists the pictures under «Images the graph receives» with their labels and who is on each. Use exactly those labels. The task also gives the clip duration and, on the final, the prompt of the approved preview (the motion to keep).

## 2. `prompt.md` is the model's text, exactly

No `##` headings, no Markdown. The sections are plain lines that end with a colon, in this order. English only.

```text
subject_definitions ASTROCINEMAV01K2T:
<Subject 1> is the young woman defined by <Picture 2>. Use <Picture 2> for her face: <hair, face, a few words>. Her clothes and body are the ones already on her in <Picture 1>. <what she holds, if it matters>
<Subject 2> is the young man defined by <Picture 3>. Use <Picture 3> for his face: <hair, face, a few words>. His clothes and body are the ones already on him in <Picture 1>.

<Picture 1> is the opening frame and the place. The video begins on this exact picture: the same camera, the same framing, the same people in the same poses, the same clothes, the same light, every object in its place.

summary:
[reference generation] A <N>-second shot. <Picture 1> is the first frame. <Picture 2> is <Subject 1>'s face. <Picture 3> is <Subject 2>'s face.

retention_analysis:
Every person keeps the face from their picture and the clothes already on them in <Picture 1>. fully_preserved through the whole shot.

detailed_description:
The shot lasts <N> seconds and never cuts.

[Shot 1] <camera>. <where everyone is, exactly as in <Picture 1>>. <the action, in order, with timing>. <the lines>. <how the shot ends>.

overall_soundscape:
<the sound of the place and of the action>

non_diegetic_music:
None.
```

1. **The first line is always `subject_definitions ASTROCINEMAV01K2T:`.** `ASTROCINEMAV01K2T` is the trigger word of the Cinema LoRA. The board puts the line first if it is missing; write it yourself so it is not doubled.
2. **People are `<Subject 1>`, `<Subject 2>`, …** in the order of the task list. No names from the task, the shot text or the files.
3. **Each person is bound once**, in `subject_definitions`, to their own picture. For a face sheet (the list says «face sheet»): `Use <Picture N> for her face: it shows the same face from several angles.` The sheet is one person, never several. For a single face: `Use <Picture N> for her face`. For an approved figure (the list says «approved figure and clothes»): `<Subject N> is the young man defined by <Picture N>: his face and hair as in <Picture N>`. The clothes always come from `<Picture 1>`, because that is what the people already wear in the opening frame.
4. **A few identifying words per person** (hair, face), as the picture shows them. Do not list clothes: `<Picture 1>` shows them.
5. **`<N>`** is the clip duration from the task, in `summary` and in `detailed_description`.
6. **`summary`** names every picture once: the first frame, then whose face each picture is.
7. **`retention_analysis`** says `fully_preserved`. `partially_preserved` or «adapted» lets the model change the people.
8. **`non_diegetic_music:`** stays `None.` unless the user asks for music.

## 3. `detailed_description`: the motion

There is no video to copy the motion from, so the text carries all of it.

1. **Where the motion comes from.** On the video preview: the shot action and the user's notes say what happens; the first frame description says where everyone is at the start. On the final: the task gives the prompt of the approved preview; keep its movements, their order and their timing, written in this form (a MiniMax preview prompt is already in this form). If the current `prompt.md` is in another workflow's form (an LTX `use image as the first frame.` prompt), rewrite it in this form and keep its content.
2. **The start is `<Picture 1>`.** Describe the positions, poses and gaze as they are in the first frame; the action continues from there. Every person who has no action in the shot gets one sentence that holds them: `<Subject 1> stands on the same spot until the end of the shot, her arms at her sides`. A standing person's place is a spot next to something in the frame, not a part of a route.
3. **The camera in one or two short sentences**, at the start and at the end: `A static medium shot at seated height.` … `The camera holds unmoving.` If the shot moves the camera, one move and its speed.
4. **Timing**: `for one second, then…`, `at the same moment…`, `only at the very end…`. The main movement starts within the first second unless the shot is about a pause. A reaction to a line starts right after the line: `right after her line she stands up`. The action fills the duration; the last line says how the shot ends: `until the end of the shot both stay seated`.
5. **Gaze with a target**: `looks along the path at the far lamp post`, `looks at <Subject 2>`. Nobody looks into the lens unless the task says so; people who talk look at each other.
6. **Two people moving**: each one's pace and how the distance between them changes: `<Subject 2> follows at a slow walk, and the gap between them grows until the end`.
7. **Light**: one sentence with the light that is in `<Picture 1>`, taken from the first frame description. No light of your own.

### Lines

The shot's lines (section «Lines» of the task, `speech.md`) go into `detailed_description` at the moment they are spoken, in the model's tag: `<Subject 1> says quietly, <d>[English] It is kind of scary.</d>` One sentence per line, the speaker by label, the words inside `<d>[English] …</d>`. An English line is copied word for word. A line in Cyrillic is written in English. Lines never go into `overall_soundscape`. No lines in the task — nobody speaks.

While someone speaks, say what the others do: `At the same moment <Subject 2> stays seated and slowly licks his ice cream.`

## 4. Words that make the model do something else

What we learned on the earlier H3 graph still holds for the text:

| Word in the text | What the model does | Write instead |
| --- | --- | --- |
| close-up, focusing on her face | moves the camera closer | the shot size of `<Picture 1>` + what is in the frame |
| looks around, glancing | turns the head | looks at <target>, the gaze stays there |
| hurries, urgent, frantic | jerks | steady, even pace |
| camera pans / follows | moves the camera | static shot, the camera holds |
| pours, boiling, splashing | splashes, glints | a slow, thin, gentle trickle |
| crystalline, glass, glint, shiny | sparks, shine | matte, soft diffused light |
| an action already visible in `<Picture 1>` | repeats it | already there in `<Picture 1>` and stays as it is |

**Say what must be there, not what must not.** `no sparkles` makes sparkles. Before writing `not`, `no`, `never`, `do not`, find what in the text can cause the unwanted result and replace it with the wanted state (`matte surfaces, calm air`). A negation stays only when a run already showed the error and the positive wording did not fix it.

**Shorter is better.** Every fix that worked replaced or removed a phrase. New events to fill the time (glances, pauses) make the people improvise.

## 5. Before a run

1. The first line is `subject_definitions ASTROCINEMAV01K2T:`.
2. Every picture from the task list is named, with the same label; each person is bound once to their own picture; no names.
3. `<N>` = the clip duration from the task.
4. `retention_analysis`: `fully_preserved`.
5. The motion follows the shot action and the notes (on the final: the approved preview); the start matches `<Picture 1>`; the camera is said at the start and the end; the shot ends without a new event.
6. Every line of `speech.md` is in `detailed_description` in `<d>[English] …</d>`; none in the soundscape.
7. No words from the table in section 4; no negation where the wanted state can be said.
8. `non_diegetic_music: None.` unless asked.

## 6. Variants and defaults

Video preview: LTX (`video_ltx`) is the default; «▶ All shots» runs LTX and then this MiniMax variant on every shot. Table: `playbooks/stages/video_preview.en.md`.

Final render (table: `playbooks/stages/final_render.en.md`): the final follows the approved preview. A MiniMax preview makes `final_h3_cinema` the default, an LTX preview makes `final_ltx` the default. Otherwise one speaker defaults to `final_h3_cinema`; two or more default to HeyGen (`final_heygen`, the cloud runs only after the user ticks the box for this one run); nobody speaking defaults to Wan (`final_wan_720`). If the selected variant does not fit the shot, write its id in `suggestedWorkflow` of `agent_request.json`.
