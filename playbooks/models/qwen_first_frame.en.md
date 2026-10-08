# Model: Qwen first frame

English copy for the model. Russian original: `playbooks/models/qwen_first_frame.md`.

Prompt for placing a character into a location, Qwen Image 2.1 Edit. Where files go: `playbooks/stages/first_frame.en.md`. Graph: `playbooks/workflows/first_frame_comfy.en.md`.

These rules were checked on a previous series: 12 shots, about 110 generations. A single character, a simple pose, and an obvious place worked on the first run. Two people, a small physical detail, and the surface under the feet took the longest.

The second series (episode ep2, about 75 runs) added the section «Shot size». Most of the long runs were medium shots and close-ups written with the long-shot rules: the figure came out full height, or the model redrew the room to make the person bigger.

## Block order

Each block is one or two sentences. Say what to place and where first. Say what to keep last. Stay under about 200 words. Past about 250 words and 8 demands, the model keeps only some of them.

```text
Place the girl from image 2 into the <place, one word> from image 1.
<where, described by what is visible on image 1>
<size in the frame: by the shot size, see «Shot size»>
<one action, body direction, where they look>
<only a story detail, or a detail that already broke>
Amateur snapshot, no special lighting on her: same dim <colour> light, same colour cast, face in shadow.
<lock: by the shot size, see «Lock»>
```

For a man, change `girl` to `man`.

### Image numbers

The task lists the images the graph receives under «Images the graph receives». Use exactly those numbers. image 1 is the location. The characters follow in alphabetical order of their names, not in the order of shot.md: with Lena and Julia, Julia is image 2 and Lena is image 3.

With two people, give every person a name and a number in the first sentence, and use the names after that: `Place Julia (image 2) and Lena (image 3) into the lecture hall from image 1.` In ep2 the prompts said `Lena from image 2` while image 2 was Julia, and the two girls swapped roles for nine runs.

Do not describe what a person looks like from memory: hair, glasses, clothes come from the reference. A wrong description (`Lena in her sweater`, when the sweater is Julia's) pulls the model to the wrong person.

Never write a file name or a path (`refs/portret.png`, `shots/s10/...`) in the prompt. The model sees only images by number. The board refuses to run a prompt with a file name in it.

### What and where

Keep it short: `Place the girl from image 2 into the street from image 1`.

Do not describe clothing. It comes from the reference. Describe clothing only when it must change relative to the reference: no trousers, sleeves rolled, jacket open.

### The exact spot

The model does not apply words like “sidewalk” or “edge of the bed” to a specific picture.

`She runs on the sidewalk` left her on the grass for several rounds. This worked: `She runs on the grey paved strip at the very bottom of the frame, right next to the curb of the road, in front of the grass`.

Describe the spot the way it looks on image 1: colour, neighbouring objects, part of the frame.

### Shot size

Take the shot size from the first words of the shot text (`Close up`, `Medium shot`, `Long shot`). A user message wins over shot.md: `ещё ближе`, `очень крупный план` mean a close-up. Each size has its own size block and its own lock. Do not mix them.

**Long shot.** The person is small in the room. Tie height to an object: `the top of her head is at the height of the window sill`. `her head at three quarters of the wardrobe's height`. `the SAME HEIGHT as the girl, the top of his head at the same level as hers`. `small`, `correct human scale`, and `do not make her big` did not work. `about one quarter of the frame height` helps partly. A foreground spot makes the figure larger; balance that with a fraction of the frame. Fractions of the frame belong only here.

**Medium shot.** Describe the size by where the frame cuts the body, not by a fraction: `she is close to the camera, visible from the waist up, the bottom edge of the frame cuts her at the waist, her head in the upper third of the frame`. For people at a desk: `the desk edge crosses her at the waist`. Do not write `stands in the middle of the floor`, `one third of the frame height`, or anything that shows the feet: with a full-height reference, `stands` alone gives a figure with boots.

**Close-up.** The first sentence is the framing: `Close-up portrait: her face and shoulders fill most of the frame, her eyes in the upper third.` Then gaze and expression. Nothing about the floor, legs or the whole body. In ep2 the close-up came out only when the prompt started like this and the line `the same camera position, the same framing` was gone.

A prompt for a medium shot or a close-up does not move the camera inside the room. The person comes towards the camera, the bottom edge of the frame cuts them, and the room behind stays as it is (see «Lock»). If the shot needs a different view of the room, that is the location stage's job, not this prompt's.

### Face for a close-up

The task may list face references under «Images the graph receives»: portraits of the characters, after the characters. The board sends them only if the prompt contains the phrase `face from image N`. You decide:

- **Close-up of a person** (or the user asks for a very close face): add one line with that person's face number from the list: `Her face exactly as the face from image 3: the same eyes, nose, lips and skin.` With two people, write it only for the one in close-up: `Julia's face exactly as the face from image 4.`
- **Medium or long shot**: do not write the phrase. One reference per person is enough there, and an extra image costs time.

The face images come after the characters, so the location and character numbers do not change whether you use the face or not.

### Pose and gaze

One main action. The model takes the direction of movement from the pose in the reference. If the picture runs to the right and the shot needs left, about half the seeds ignore the text. Use a reference that already faces the right way, or run 5–10 seeds.

Write the gaze explicitly: `looks down at her knee, NOT at the camera`. Otherwise the gaze often goes into the lens.

Describe difficult geometry physically. For a mirror this worked: `stands squarely facing the mirror, shoulders parallel to it, looks at her own eyes in the mirror, NOT into the lens`. `looks at herself` is not enough.

Extra hands disappeared after: `elbows out to the sides, her own hands behind her head, the arms clearly belong to her shoulders`.

### Details

Write only what the story needs, or what already broke.

Name location objects that disappear: `striped glass cup with toothbrushes, tall yellow shampoo bottles, all sharp, in the same places`.

Put a detail in an exact spot: `the blood stain is exactly where the tissue touches her nostril`.

If the reference contradicts the needed state, say so: `the braid is NOT finished, NO hair tie (unlike image 2)`. Or use another reference.

A small detail such as blood is more reliable as a second step, an edit of a finished frame. Built from scratch, it comes out too large.

### Light

`match the lighting` does almost nothing. The character stays studio-lit and brighter than the room.

This combination works: `amateur snapshot, no special lighting on the person`, then a named colour cast. Examples: `cold blue-grey cast like the white bed sheets and the walls`. `dim blue twilight, face in shadow, dark reflection on the wet paving`. If needed, `slightly underexposed like everything around`.

The word `warm` without a sample produced a hard orange. A sample picture beats words: feed another frame of the same location with the light you want and write `change ONLY the lighting and colour so they match image 2`.

### Lock

The last line depends on the shot size.

Long shot:

```text
Keep the location from image 1 exactly as it is: the same camera position and angle, the same framing, the same objects in the same places. Do not add any other people.
```

Medium shot. The room must not be redrawn to make room for the people. Name the objects the user cares about (in ep2: the window, which kept moving):

```text
The room behind them stays exactly as in image 1: the same window in the same place and size, the same walls. They are in front of it, close to the camera. Do not add any other people.
```

Close-up. Do not ask for the same framing: the model then keeps the wide view and leaves the person small.

```text
Behind her is the room from image 1, the same walls and objects, seen closer and slightly out of focus. Do not add any other people.
```

Do not describe the surroundings. The exceptions are objects that disappear, and the objects used as landmarks for place and scale.

Camera directions (`low angle`, `ground level`) are ignored. image 1 sets the angle.

If image 1 is only a fragment (a wall, a few steps, a texture), the model invents the rest of the room for a medium or long shot, and invents it differently on every seed. A close-up works with a fragment: in ep2 the close-up on a plain wooden panel was accepted on the first run. For a medium or long shot ask for a location view that shows the whole spot.

## Modes

Assemble from scratch when the composition changes. Edit a finished frame when the change is local:

```text
Edit image 1: <one change>. Keep EVERYTHING else exactly the same: <what must not move>.
```

`much less blood` can remove the blood entirely. Write the target state: `a small red stain the size of a coin exactly at the nostril`.

No more than one or two edits in a row. After that, assemble again from the clean location.

## Do not write

- A long clothing description when the reference already has the clothes.
- A description of the whole surroundings.
- A negation without a positive replacement. `not on the grass` is weaker than describing the grey strip by the curb.
- `IMPORTANT`, capitals, and repeating one demand.
- `small`, `correct scale`, `realistic proportions` without an object.
- A long style tail. One short line at the end is enough if you need it.

## Before a run

1. Assembly or edit.
2. Shot size taken from shot.md or the user message. The size block and the lock match it.
3. Image numbers taken from «Images the graph receives». Every person has a name and a number. No file names or paths.
4. Close-up: the face line `face from image N` for the person in close-up. Medium and long: no face line.
5. The spot is described through what is visible on image 1.
6. Long shot: height tied to an object. Medium: where the frame cuts the body. Close-up: the face fills the frame.
7. One action, body direction, and gaze.
8. The reference does not contradict the shot. If it does, write `unlike image 2` or pick another file.
9. Details are only story details or details that already broke.
10. Light: amateur snapshot plus a named colour, or a sample picture.
11. Under about 200 words.
12. Run 2–5 seeds at once. For two people and for direction, run 5–10.

## A prompt that was accepted

This failed: a long clothing list, `wet pavement`, `one third of the frame height`, `Cinematic film still`. The figure was large, studio-lit, and standing on the grass.

The accepted prompt:

```text
Place the girl from image 2 into the street from image 1. She runs on the grey paved strip at the very bottom of the frame, right next to the curb of the road, in front of the grass; both boots on this strip. She is at the very left edge of the frame, just entering from the left, running from left to right, mid-stride, one hand on the bag strap, head turned up to the right, lost and panicked. She is fairly small: about one quarter of the frame height, in proportion to the birch tree and the parked car. Amateur snapshot, no special lighting on her: a dark figure in the dim blue dusk, face in shadow, dark reflection on the wet paving. Keep the location from image 1 exactly as it is. Do not add any other people.
```

## Accepted in ep2: close-up and medium shot

Close-up (s03, accepted on run 13; runs 1–5 gave a full-height figure because the prompt said `She stands in the middle of the floor` and `the same framing`):

```text
Place the girl from image 2 into the lecture hall from image 1. Her face fills most of the frame, an extreme close-up. She is turned to the left in profile, her face dominating the entire composition. She looks to the left, NOT at the camera. Her expression is calm and composed. She gazes thoughtfully around the room.
Amateur snapshot, no special lighting on her: the same cool, even institutional light as the lecture hall.
Keep the location from image 1 exactly as it is. Do not add any other people.
```

Today this prompt would also get the close-up lock and, if the face drifts, the face line `Her face exactly as the face from image 3`.

Medium shot (s06, accepted). It worked because the location was already shot at the podium's distance, and an object (the podium) cuts the body:

```text
Place the professor from image 2 into the lecture hall from image 1. He stands behind the podium, his torso visible above the edge, shoulders and head clearly his own. The top of his head reaches about three quarters of the way up the tiered seating behind him. Both arms raised up at shoulder height, palms open, his mouth open, expression stern and commanding. He looks straight ahead and slightly down, angry, NOT at the camera. His body leans forward over the podium. Amateur snapshot, no special lighting on him: the same harsh overhead fluorescent light, sharp shadows across his face and neck, a hard edge where the podium cuts across his body. Keep the location from image 1 exactly as it is: the same camera position and angle, the same framing, the same objects in the same places. Do not add any other people.
```
