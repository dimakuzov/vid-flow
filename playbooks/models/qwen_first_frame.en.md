# Model: Qwen first frame

Prompt for placing a character into a location, Qwen Image 2.1 Edit. Where files go: `playbooks/stages/first_frame.en.md`. Graph: `playbooks/workflows/first_frame_comfy.en.md`.

These rules were checked on a previous series: 12 shots, about 110 generations. A single character, a simple pose, and an obvious place worked on the first run. Two people, a small physical detail, and the surface under the feet took the longest.

The second series (episode ep2, about 75 runs) added the section «Shot size». Most of the long runs were medium shots and close-ups written with the long-shot rules: the figure came out full height, or the model redrew the room to make the person bigger.

The third episode (episode3, 15 shots, about 70 runs) added the section «First: the references win over the text». Two things caused most of the repeats. The model changed the location: it moved and added objects, changed the buildings and the light (the user wrote «do not change the location, do not move or add anything», «do not change the light either»). And the prompt described clothes that were not on the reference: Ivan in the «wet dark coat» from shot.md instead of the white jacket on his reference, a bag «big enough to hold several books» instead of the sack-like bag on the reference; the bag had to be fixed in four shots.

## First: the references win over the text

The only goal of this stage is to add the characters into the location. Nothing else changes.

- **The location is image 1 as it is.** The same camera position, angle and framing, the same objects in the same places, the same light and colours. Nothing added, removed, moved or redrawn. This holds for every shot size: long, medium and close-up.
- **A character looks as on their reference.** The same clothes, shoes, bag, hat, hair and everything they wear or carry. Do not describe clothes, the bag or other items at all: only the line «as in image N» (see «Clothes and items»).
- **The shot text (shot.md) does not argue with the references.** If shot.md says «dark coat» and the reference shows a white jacket, the reference is right. If shot.md has rain, fog, a street lamp or a light that image 1 does not show, they are not in the prompt either: weather and light belong to the location, and this stage does not change it.
- **The only exception is an explicit request from the user** in the message to the agent: «put her in a coat», «give her a bag», «make it darker». Then the prompt has one line about that change, and everything else follows the rules above.

## Block order

Each block is one or two sentences. Say what to place and where first. Say what to keep last. Stay under about 200 words. Past about 250 words and 8 demands, the model keeps only some of them.

```text
character1 is image 2.                      (with a portrait: character1 is image 2 and the face from image 3.)
<Shot size>. Add character1 <on the exact spot, described by what is visible on image 1>.
<size in the frame: by the shot size, see «Shot size»>
<one action, body direction, where they look>
<only a story detail, or a detail that already broke>
character1's clothes, shoes, bag and everything they wear or carry exactly as in image 2.
character1 is lit by the same light as everything in image 1.
<lock, see «Lock»>
```

With two people: the first lines bind character1 and character2, then one sentence adds both on their spot.

Every idea appears once: the people are added once (the «Add» sentence), image 1 is kept once (the lock), each reference is bound once. The lock does not say again that people are added.

### Image numbers

The task lists the images the graph receives under «Images the graph receives», and what each one shows. Use exactly those numbers. image 1 is the location. The characters follow in alphabetical order of the file name, not the order of shot.md: with Lena and Julia, Julia is image 2 and Lena is image 3. In the prompt they are character1 and character2 in that same order, never Julia and Lena. Then the portraits, same numbers: character1's face is image 4, character2's face is image 5. Up to 6 images in all; anything that did not fit is named separately in the task, do not refer to it.

Every image in the list goes to the model, so the prompt names each one: who is on it and what it is for. An image the prompt does not mention confuses the model: it does not know where to put it and may paint a portrait in as a second person.

With two people, bind each one to the images in the first sentences, then one or two sentences so the model can tell them apart: `character1 is image 2 and the face from image 4. character2 is image 3 and the face from image 5. Medium shot. Add character1 and character2, both at the second desk from image 1, …` In ep2 the prompts said `Lena from image 2` while image 2 was Julia, and the two girls swapped roles for nine runs. A production name does the same: the model does not know which picture it belongs to.

Do not describe what a person looks like from memory: hair, glasses, clothes come from the reference. A wrong description pulls the model to the wrong person. Do not write the name from the task.

Never write a file name or a path (`refs/portret.png`, `shots/s10/...`) in the prompt. The model sees only images by number. The board refuses to run a prompt with a file name in it.

### Add and place in one sentence

One sentence adds the people and puts them on their spot: `Add character1 and character2, both sit on the wooden bench from image 1, on the right of the frame`. Do not write a separate `Place … into the park from image 1` before it: that gives the same people two places (the path, then the bench) and two orders to add them.

### Say what you want, not what to avoid

The model reads every word as part of the picture. A negation puts the unwanted thing into the prompt: `NOT at the camera` adds the word camera, `do not add other people` adds people. Before writing `not`, `no`, `never`, `do not`, `NOT`:

1. Find what in the prompt or in the references can cause the unwanted result: a missing target, a word that suggests it, a pose on the reference.
2. Fix that cause, and write the wanted state as a fact.

| Instead of | Write |
| --- | --- |
| `looks to the left, NOT at the camera` | `looks past the left edge of the frame, towards the window` (the gaze has a target) |
| `NOT standing` | `sits on the bench, back against the backrest, knees bent` |
| `not on the grass` | `on the grey paved strip right next to the curb` |
| `Do not add any other people` | `The only people in the frame are character1 and character2.` |
| `nothing moved` | `every object in the same place and size` |
| `the braid is NOT finished, NO hair tie` | `the braid is half done, the loose end hangs free, unlike image 2` |

A negation stays only when a run already showed the error and the positive wording did not fix it; one per prompt at most. When the user's message says "not …", turn it into the wanted state the same way.

### No character references

When «Images the graph receives» lists only image 1, the shot has no characters. Do not write `image 2` and do not invent a person. image 1 stays exactly as it is: the same place, camera, objects and light. Add only what the shot action and the user's request ask to add, and nothing else. Start with `Edit image 1:` and name that addition. Do not describe the place again.

### Clothes and items

Clothes, shoes, the bag, a hat, an umbrella and every other item come from the character's reference, unchanged. Do not describe them: no colour, cut, size, «closed», or «on the shoulder». The model draws any description its own way: in episode3 `a large black shoulder bag, big enough to hold several books` produced a different bag, and the user wrote «the bag is a sack» four times.

Instead of a description, one line per person:

- One person: `character1's clothes, shoes, bag and everything she wears or carries exactly as in image 2.`
- Two people: `character1's clothes exactly as in image 2. character2's clothes and bag exactly as in image 3.`

Do not take clothes from the shot text (shot.md): when it differs from the reference, the reference is right.

Change clothes or items only when the user explicitly asks («no jacket», «sleeves rolled up», «put a sack-like bag on her shoulder»). Then write one line about that change, and everything else stays `exactly as in image 2`. If the user asks for an item the reference already has, do not describe it again: write `her bag exactly as in image 2`.

### The exact spot

The model does not apply words like “sidewalk” or “edge of the bed” to a specific picture.

`She runs on the sidewalk` left her on the grass for several rounds. This worked: `She runs on the grey paved strip at the very bottom of the frame, right next to the curb of the road, in front of the grass`.

Describe the spot the way it looks on image 1: colour, neighbouring objects, part of the frame. This is a landmark for the person, not a new description of the location: do not add objects that image 1 does not have.

When the location description shows more than one space, put each person in the space the shot action gives them, on a surface where a person can stand. Take the distance between them from the sizes of those spaces in the description. Keep an opening between the spaces shut, partly open or open exactly as image 1 shows it, and place the people on the sides the action needs. Do not invent a space or an opening that image 1 does not have.

### Shot size

When the task has a «Distance from the camera» block, each person's size comes from it, not from the first words of the shot text; write that person's size block from it. A size the user writes in the message wins over the block for that run. Without the block, take the shot size from the first words of the shot text (`Close up`, `Medium shot`, `Long shot`). A user message wins over shot.md: `closer`, `very tight close-up` and `much closer` mean a close-up. Rewrite the size sentences to the close-up block below. Never compare with the previous picture: `much closer to the camera than before`, `closer than before`, `than before`, `as before` are forbidden, and the board will not run a prompt that contains them. The model has not seen that picture. Say how close the person is now. If prompt.md already has such a comparison, delete it. Each size has its own size block. The lock is the same for all of them (see «Lock»).

The camera and the location never move, whatever the shot size. The size comes only from how close to the camera the person stands.

**Long shot.** The person is small in the room. Tie height to an object: `the top of her head is at the height of the window sill`. `her head at three quarters of the wardrobe's height`. `the SAME HEIGHT as the girl, the top of his head at the same level as hers`. `small`, `correct human scale`, and `do not make her big` did not work. `about one quarter of the frame height` helps partly. A foreground spot makes the figure larger; balance that with a fraction of the frame. Fractions of the frame belong only here.

**Medium shot.** Describe the size by where the frame cuts the body, not by a fraction: `she is close to the camera, visible from the waist up, the bottom edge of the frame cuts her at the waist, her head in the upper third of the frame`. For people at a desk: `the desk edge crosses her at the waist`. Do not write `stands in the middle of the floor`, `one third of the frame height`, or anything that shows the feet: with a full-height reference, `stands` alone gives a figure with boots.

**Close-up.** The person is right at the camera: `She stands right in front of the camera, very close: her face and shoulders fill most of the frame, her eyes in the upper third.` Then gaze and expression. Nothing about the floor, legs or the whole body. The location behind her is the same as in image 1; nothing is redrawn.

If the location is shot from too far away and the person does not fit it at the needed size, that is the location stage's job (another view of the place), not this prompt's. Do not ask the model to «move closer» or «show the room closer»: in episode3 that made it redraw the stairs and the walls.

### Portraits

Under «Images the graph receives» the characters are followed by their portraits (`character1 face`). The board always sends a portrait when one exists. For every portrait the prompt has one line saying whose face it is, by the character number and the image number.

- One person: `character1 is image 2 and the face from image 3: her face exactly as in image 3, the same eyes, nose, lips and skin.`
- Two people: `character1's face exactly as in image 4, character2's face exactly as in image 5.`
- A portrait is the face only. Clothes, pose and height come from the character reference (image 2, image 3). Do not write `the girl from image 4`: the model adds an extra person.
- With two or more people, a portrait can come out as one more person, or as a mix of two people (one person's head on another person's clothes). Bind each face to its own character in the first lines and keep the count sentence (see «Lock»).
- A person marked `seen from behind` in the distance block has no portrait in the image list. Write `seen from behind, her face hidden` and no face line for that person.

The portraits come after the characters, so the location and character numbers do not depend on whether a portrait exists.

### Pose and gaze

One main action. The model takes the direction of movement from the pose in the reference. If the picture runs to the right and the shot needs left, about half the seeds ignore the text. Use a reference that already faces the right way, or run 5–10 seeds.

Write the gaze explicitly, with a target in image 1: `looks down at her knee`, `looks along the path at the far lamp post`. Without a target the gaze goes into the lens. Unless the shot text or the user asks otherwise, nobody looks at the camera, and the target is: people who talk look at each other's faces, heads and shoulders turned to each other; a person who walks is mid-stride, one foot in front of the other, and looks ahead in the direction of walking; anyone else looks at what the action is about.

Describe difficult geometry physically. For a mirror this worked: `stands squarely facing the mirror, shoulders parallel to it, looks at her own eyes in the mirror`. `looks at herself` is not enough.

Extra hands disappeared after: `elbows out to the sides, her own hands behind her head, the arms clearly belong to her shoulders`.

### Details

Write only what the story needs, or what already broke.

Name location objects that disappear: `striped glass cup with toothbrushes, tall yellow shampoo bottles, all sharp, in the same places`.

Put a detail in an exact spot: `the blood stain is exactly where the tissue touches her nostril`.

If the reference contradicts the needed state, say so: `the braid is half done, the loose end hangs free (unlike image 2)`. Or use another reference.

A small detail such as blood is more reliable as a second step, an edit of a finished frame. Built from scratch, it comes out too large.

### Light

The light and colours of the location do not change. The person gets the light that is already in image 1, not a light of their own.

One line: `character1 is lit by the same light as everything in image 1.` If needed: `slightly underexposed like everything around`.

Do not name a light or colour of your own: no `harsh yellow lamp`, `cold blue-grey cast`, or `dim blue twilight`, unless you are sure that is exactly what image 1 shows. The model paints a named colour over the whole picture: in episode3 the user wrote «do not change the light either». `match the lighting` does almost nothing on its own: the character stays studio-lit and brighter than the room, which is why the line above is needed.

Do not add weather or effects (rain, fog, light beams, reflections) that image 1 does not show: they change the location. Falling rain belongs to the video.

Change the light only when the user explicitly asks. Then edit the finished frame from a sample: feed another frame of the same location with the light you want as the second image and write `change ONLY the lighting and colour so they match image 2`. The word `warm` without a sample produced a hard orange.

### Lock

The last line is the same for every shot size. It keeps image 1 and names who is in the frame; it does not say again that people are added:

```text
Keep image 1 exactly as it is: the same camera position, angle and framing, every object in the same place and size, the same light and colours. The only people in the frame are character1 and character2.
```

One person: `… character1 is the only person in the frame.`

With two or more people, also say the count right after the binding lines, before anything else: `Exactly two people are in the frame: character1 and character2, each one once.` Keep the lock sentence at the end as well. In episode_11 a third person appeared even with the lock sentence alone: Ivan's head on Lena's jacket, skirt and heels.

The user asked to change something in image 1 (remove a bin, open a door): `Keep image 1 exactly as it is, except <the change, as the target state>: …`.

If an object already disappeared or moved, name it in the lock: `the same window in the same place and size, the same handrail`.

Do not describe the surroundings. The exceptions are objects that disappear, and the objects used as landmarks for place and scale.

Do not write camera directions (`low angle`, `ground level`, `top-down view`): image 1 sets the angle.

If image 1 is only a fragment (a wall, a few steps, a texture), the model invents the rest of the room for a medium or long shot, and invents it differently on every seed. A close-up works with a fragment: in ep2 the close-up on a plain wooden panel was accepted on the first run. For a medium or long shot ask for a location view that shows the whole spot.

## Modes

Assemble from scratch when the composition changes. Edit a finished frame when the change is local:

```text
Edit image 1: <one change>. Keep EVERYTHING else exactly the same: <what must not move>.
```

`much less blood` can remove the blood entirely. Write the target state: `a small red stain the size of a coin exactly at the nostril`.

No more than one or two edits in a row. After that, assemble again from the clean location.

## Do not write

- A description of clothes, shoes, the bag or other items. Only `exactly as in image N`, unless the user explicitly asks for a change.
- Clothes and items from shot.md when they differ from the reference.
- A light, colour, weather or effect of your own that image 1 does not show.
- A description of the whole surroundings, or objects image 1 does not have.
- A camera angle or camera move, «show the room closer».
- A negation where the wanted state can be said (see «Say what you want, not what to avoid»).
- The same demand twice: a second sentence that adds the people, a `Place … into` before the «Add» sentence, the lock repeating that people are added, `Nothing changed.` after the clothes lines.
- Lines left over from an earlier version of the prompt that no longer serve the request.
- `IMPORTANT`, capitals, and repeating one demand.
- `small`, `correct scale`, `realistic proportions` without an object.
- A long style tail. One short line at the end is enough if you need it.

## Before a run

1. Assembly or edit.
2. Shot size taken from shot.md or the user message. The size block matches it; the camera and the location do not move.
3. Image numbers taken from «Images the graph receives». People are character1, character2 by those numbers. No names, file names or paths.
4. Every image in the list is named in the prompt. For every portrait, a line `characterN's face exactly as in image N`.
4a. One «Add» sentence puts the people on their spot; no separate `Place … into`. Every idea appears once.
4b. No negation where the wanted state can be said. Each `not` / `NOT` / `do not` left has a run behind it.
5. For every person, a line `clothes … exactly as in image N`. Clothes and items are not described, except what the user explicitly asked to change.
6. The spot is described through what is visible on image 1, with no new objects.
7. Long shot: height tied to an object. Medium: where the frame cuts the body. Close-up: the person right at the camera.
8. One action, body direction, and a gaze with a target.
9. The reference does not contradict the shot. If it does, write `unlike image 2` or pick another file.
10. Details are only story details or details that already broke.
11. Light: `the same light as everything in image 1`, no colours, weather or effects of your own.
12. The last line is the lock from «Lock».
13. Under about 200 words.
14. Run 2–5 seeds at once. For two people and for direction, run 5–10.

## A prompt that was accepted

This failed: a long clothing list, `wet pavement`, `one third of the frame height`, `Cinematic film still`. The figure was large, studio-lit, and standing on the grass.

The accepted prompt (the clothes, light and lock lines rewritten to today's rules):

```text
character1 is image 2. Long shot. Add character1 running on the grey paved strip at the very bottom of the frame, right next to the curb of the road, in front of the grass; both boots on this strip. She is at the very left edge of the frame, just entering from the left, running from left to right, mid-stride, one hand on the bag strap, head turned up to the right, lost and panicked. She is fairly small: about one quarter of the frame height, in proportion to the birch tree and the parked car. character1's clothes, shoes, bag and everything she wears or carries exactly as in image 2. She is lit by the same light as everything in image 1, a dark figure, face in shadow. Keep image 1 exactly as it is: the same camera position, angle and framing, every object in the same place and size, the same light and colours. character1 is the only person in the frame.
```

## Accepted in ep2: close-up and medium shot

Close-up (s03, accepted on run 13; runs 1–5 gave a full-height figure because the prompt said `She stands in the middle of the floor`). The clothes, light and lock lines are rewritten to today's rules:

```text
character1 is image 2. Close-up. Add character1 standing right in front of the camera, very close: her face fills most of the frame. She is turned to the left in profile and looks past the left edge of the frame, towards the far rows of the hall. Her expression is calm and composed.
character1's clothes exactly as in image 2. She is lit by the same light as everything in image 1.
Keep image 1 exactly as it is: the same camera position, angle and framing, every object in the same place and size, the same light and colours. character1 is the only person in the frame.
```

If character1 has a portrait, add the line `character1's face exactly as in image 3`.

Medium shot (s06, accepted). It worked because the location was already shot at the podium's distance, and an object (the podium) cuts the body:

```text
character1 is image 2. Medium shot. Add character1 standing behind the podium, his torso visible above the edge, shoulders and head clearly his own. The top of his head reaches about three quarters of the way up the tiered seating behind him. Both arms raised up at shoulder height, palms open, his mouth open, expression stern and commanding. He looks over the front rows towards the back of the hall, angry. His body leans forward over the podium. character1's clothes exactly as in image 2. He is lit by the same light as everything in image 1. Keep image 1 exactly as it is: the same camera position, angle and framing, every object in the same place and size, the same light and colours. character1 is the only person in the frame.
```

## Accepted with two people (bench, episode 4)

The user's own fix of an agent prompt: the people are added in one sentence together with the spot, and the lock does not repeat that they are added.

```text
character1 is image 2: a very tall, slim young man in an off-white jacket. character2 is image 3 and the face from image 4: a slim young woman with long dark brown hair and a black leather jacket.
Medium shot. Add character1 and character2, both sit on the wooden bench from image 1, on the right of the frame, backs against the backrest, close to the camera, with a small gap of empty seat between them. The bottom edge of the frame cuts them just above the knees, heads in the upper third.
character2 sits on the left half, leaning back, looking straight ahead along the path, a faint relieved smile. character1 sits on the right half, leaning back, looking straight ahead along the path, very calm, a slight smile. Each holds a waffle cone with vanilla ice cream.
character2's face exactly as in image 4. character1's clothes exactly as in image 2. character2's clothes exactly as in image 3.
They are lit by the same light as everything in image 1.
Keep image 1 exactly as it is, except the dark bin beside the bench is gone, with plain asphalt and leaves where it stood: the same camera position, angle and framing, the same bench with green cast-iron ends in the same place and size, the same lamp posts, hedge and trees, the same light and colours. The only people in the frame are character1 and character2.
```

The earlier version of this prompt said `Place them into the park path from image 1` and then `Both sit on the bench`: two places for the same people, and the model got two instructions to add them.
