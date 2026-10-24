# First frame: fixes from episodes 10 and 11

Source: `eposide_10` (14 shots) and `episode_11` (17 shots), first frame only, read only: notes, prompt history, queue jobs, output pictures.

**Status (branch `ff-people-sheets`, from `main`).**

- Applied: F1, F2, F4, F5, F6, F7, and the `ivan_sheet.png` fix.
- F2: the «Спиной» box is set from the scenario markup word `back`; a shot with one person also gets it from «спиной» / «со спины» in the shot text.
- F3 (face sheets by default) is not switched on: the check below found no gain in likeness and one extra person with sheets.
- The Russian playbook copy was not updated.

## What the pictures show

**Doubled and mixed people come with the portraits.** In every multi-person run with an extra person that I checked, the graph also got two portraits:

- `episode_11/s09` run 1: three people instead of two. The third one has Ivan's head with Lena's leather jacket, orange skirt, tights and heels. The prompt said `both seen from behind`, and both portraits went to the graph anyway. Run 2, with one portrait, still had someone in an orange skirt behind Ivan.
- `episode_11/s11` run 1: Lena is missing, and in her place stands a short-haired person in her jacket and skirt.
- `episode_11/s03`, `s10`: «only two people» after run 1, and both portraits were in the graph.
- After the user removed the portraits (`s10`, `s11` and others), the notes stop complaining about extra people.

Every prompt already ends with `The only people in the frame are character1 and character2.` (playbook, «Lock»), and `s11` even said `Exactly three people are added`. The count sentence alone did not stop it. The portraits are extra pictures of people, and with two or more people the model sometimes draws them as more people.

**Ivan's face sheet is never used.** The library file is `characters/Ivan/ivan_sheet.png`. The board looks for `face_sheet` in the name (`FACE_SHEET` in `src/lib/comfy/binding.ts`), so the video stages send Ivan's plain portrait instead. The other sheets are named `{name}_face_sheet.png` (Katya, Lena, Luba, Misha) and are found.

## F1. Count the people in the first line

When two or more people are added, the count goes into the first line after the bindings, not only into the lock at the end.

**`playbooks/models/qwen_first_frame.en.md`, section «Lock»**, add after the paragraph that starts `One person:`:

> With two or more people, also say the count right after the binding lines, before anything else: `Exactly two people are in the frame: character1 and character2, each one once.` Keep the lock sentence at the end as well.

**Same file, section «Portraits»**, add after `A portrait is the face only…`:

> With two or more people, a portrait or a face sheet can come out as one more person, or as a mix of two people (one person's head on another person's clothes). Bind each face to its own character in the first lines, and keep the count sentence from «Lock».

## F2. No portrait for a person seen from behind

A portrait of someone whose face is not visible adds nothing and adds the doubling risk (F1).

**Board** (code, not a prompt rule): next to the distance menu, each person gets a box «Спиной» («Seen from behind» in the English UI). It is stored in `first_frame/run_settings.json`, and the graph sends no portrait and no sheet for that person. The agent gets `lena: seen from behind, the face hidden` in the distance block (F6).

**`qwen_first_frame.en.md`, section «Portraits»**, add:

> A person marked «seen from behind» in the distance block has no portrait in the image list. Write `seen from behind, her face hidden` and no face line for that person.

## F3. Face sheet instead of a portrait

The video stages already prefer a face sheet. The proposal is to do the same on the first frame: sheet first, portrait only when there is no sheet. This is a change of the inputs of the existing graph, not of the graph. It should be checked on a few shots first, because a sheet is a picture with three faces and may make the doubling (F1) worse.

**Board:**

- The first-frame manifest takes the face from `refs/{name}_face_sheet`, `refs/{name}_sheet`, the library sheet, and only then the portrait.
- `FACE_SHEET` also matches `{name}_sheet` (Ivan).
- The image list says `character1 face sheet: three views of the same face`, as it already does on MiniMax.

**`qwen_first_frame.en.md`, section «Portraits»**, add:

> A face sheet is one person seen three times (front, three-quarter, profile) on one picture. Bind it like a portrait: `character1 is image 2 and the face from the sheet in image 4: one face shown from three sides; her face exactly as on that sheet.` Never write `the people in image 4` or count the faces on the sheet.

## F4. Gaze (P1, approved earlier, still not applied)

The approved text from the first round, still not in the playbook. `eposide_10/s12` and `episode_11/s17` wrote `looks straight into the lens` with no basis in the scenario. Notes: `episode_11/s11` «nobody looks at the camera», `s12` «Ivan does not look toward the camera».

**`qwen_first_frame.en.md`, section «Pose and gaze», second paragraph.**

Was:
> Write the gaze explicitly, with a target in image 1: `looks down at her knee`, `looks along the path at the far lamp post`. Without a target the gaze often goes into the lens; a target fixes it better than `NOT at the camera`.

Becomes:
> Write the gaze explicitly, with a target in image 1: `looks down at her knee`, `looks along the path at the far lamp post`. Without a target the gaze goes into the lens. Unless the shot text or the user asks otherwise, nobody looks at the camera, and the target is: people who talk look at each other's faces, heads and shoulders turned to each other; a person who walks is mid-stride, one foot in front of the other, and looks ahead in the direction of walking; anyone else looks at what the action is about.

## F5. Distance texts

`FRAMING_TEXT` in `src/lib/series/first-frame-settings.ts`, the words the agent gets for each choice.

**`face`.** `eposide_10/s12`: 4 more notes after «face close-up» (nothing below the chest, the head almost at the top edge, square to the camera). `episode_11/s14`: «she sinks under the table».

Was:
> face close-up: the face is about three quarters of the frame width, nothing below the shoulders

Becomes:
> face close-up: the face is about three quarters of the frame width, the top of the head near the top edge of the frame, the shoulders cut by the bottom edge, nothing below the shoulders

**`face` for two or more people in one frame.** Three quarters of the width each does not fit. `eposide_10/s10`: 6 notes, and in the end a waist-up run was approved. When two or more people have `face`, the board writes one line for all of them instead:

> face close-up together: their faces side by side fill the whole frame, each face about half the frame width, the tops of the heads near the top edge, the shoulders cut by the bottom edge

**`full`.** Three quarters of the frame height makes people too big on a wide location. `episode_11/s05`: three times «make Ivan smaller» so he fits into the booth. `s09`, `s11`: «make Ivan smaller».

Was:
> full figure: head to feet in the frame, about three quarters of the frame height

Becomes:
> full figure: head to feet in the frame; set the height by an object of image 1 next to the person (a door, a bench, a booth), not by a share of the frame

`background` and `waist` stay as they are.

## F6. Distance as a block of the task, not a line in the message

Since the distance is set for every person (commit `22953c7`), every message gets the distance lines. They pile up in `notes.json`, and the agent sees them in the whole history of the shot: `episode_11/s16` has 10 identical blocks. Seven notes in the two episodes are only the distance lines, with no text from the user.

**Board:**

- The agent-request route stops appending the lines to the message.
- `buildTextParts` in `src/lib/agent/task.ts` adds a block after «Images the graph receives»:

  > ## Distance from the camera (set on the board for each person; it is the current choice, the notes may show older ones)
  >
  > - character1 (ivan): full figure: …
  > - character2 (lena): seen from behind, the face hidden; waist up: …

- Captions of user references go into the same block: `- helmet.jpg: Lena's helmet`.

**`qwen_first_frame.en.md`, section «Shot size»**, first paragraph, add at the start:

> When the task has a «Distance from the camera» block, each person's size comes from it, not from the first words of the shot text. A size the user writes in the message wins over the block for that run.

## F7. Scenario names that are not in the shot

Commit `22953c7` writes the distance from the scenario markup. The markup sometimes names a person differently from the shot: `young_woman` instead of `woman_from_street` (`episode_11/s11`, `s12`, `s15`, `s16`), `militsiya_officer` instead of `militsiya_officer_young` (`s01`). The value is silently dropped, and the person gets the size from the shot text. Proposal: when the board seeds the distance, match a markup name that is not in the shot to the shot's character whose name contains it or is contained by it (`militsiya_officer` → `militsiya_officer_young`), and say in `run_log.md` what was matched or dropped.

## What to check after F1–F3

Same shots, same seeds, existing graph only:

- `episode_11/s09` and `s11` with their first prompts: portraits, sheets, no faces;
- `eposide_10/s10` with sheets.

Count the extra or mixed people.

## The check (existing graph, user's ComfyUI)

Data copy in `%TEMP%rameboard-ff2`, 18 runs: 3 shots × portrait / face sheet / no face × seeds 111111111 and 222222222.

- `a09` — `episode_11/s09`;
- `a11` — `episode_11/s11`;
- `b10` — `eposide_10/s10`.

Each prompt is the approved prompt with the new count line (F1); only the face binding differs. The sheet variant puts the library sheet in `refs/{name}_face.png`, so the graph takes it instead of the portrait. Sheets: `sheet-check-a09.jpg`, `sheet-check-a11.jpg`, `sheet-check-b10.jpg` next to this file.

| Shot | Portrait | Face sheet | No face |
|---|---|---|---|
| `a09`: Ivan at the gate, Lena close | 2 people, Lena close | 2 people, Lena close, same likeness | 2 people, but Lena full figure instead of close |
| `a11`: three people | 3 people, both seeds | seed 111: 3 people; **seed 222: a fourth person** behind Lena | 3 people, both seeds |
| `b10`: two profiles close | 2 people | 2 people, same likeness | 2 people |

**Conclusions:**

- With the count line first, no portrait run had an extra person (0 of 6). In the episode the same shots had extras.
- Face sheets did not make the faces look more alike on a still frame, and in the three-person shot one of two runs gained a fourth person. They stay off by default on the first frame. The video stages keep using sheets, now including `ivan_sheet.png`.
- Without a face picture the model drew Lena from her full-figure reference and lost the close-up. A visible face keeps its portrait; only people seen from behind lose it (F2).
