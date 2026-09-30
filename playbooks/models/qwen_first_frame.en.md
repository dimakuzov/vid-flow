# Model: Qwen first frame

English copy for the model. Russian original: `playbooks/models/qwen_first_frame.md`.

Prompt for placing a character into a location, Qwen Image 2.1 Edit. Where files go: `playbooks/stages/first_frame.en.md`. Graph: `playbooks/workflows/first_frame_comfy.en.md`.

These rules were checked on a previous series: 12 shots, about 110 generations. A single character, a simple pose, and an obvious place worked on the first run. Two people, a small physical detail, and the surface under the feet took the longest.

## Block order

Each block is one or two sentences. Say what to place and where first. Say what to keep last. Stay under about 200 words. Past about 250 words and 8 demands, the model keeps only some of them.

```text
Place the girl from image 2 into the <place, one word> from image 1.
<where, described by what is visible on image 1>
<scale tied to a specific object on image 1>
<one action, body direction, where they look>
<only a story detail, or a detail that already broke>
Amateur snapshot, no special lighting on her: same dim <colour> light, same colour cast, face in shadow.
Keep the location from image 1 exactly as it is. Do not add any other people.
```

For two people: `Place the girl from image 2 and the young man from image 3`. For a man, change `girl` to `man`.

### What and where

Keep it short: `Place the girl from image 2 into the street from image 1`.

Do not describe clothing. It comes from the reference. Describe clothing only when it must change relative to the reference: no trousers, sleeves rolled, jacket open.

### The exact spot

The model does not apply words like “sidewalk” or “edge of the bed” to a specific picture.

`She runs on the sidewalk` left her on the grass for several rounds. This worked: `She runs on the grey paved strip at the very bottom of the frame, right next to the curb of the road, in front of the grass`.

Describe the spot the way it looks on image 1: colour, neighbouring objects, part of the frame.

### Scale

`small`, `correct human scale`, and `do not make her big` did not work. `about one quarter of the frame height` helps partly.

Tie height to an object: `the top of her head is at the height of the window sill`. `her head at three quarters of the wardrobe's height`. `the SAME HEIGHT as the girl, the top of his head at the same level as hers`.

A foreground spot makes the figure larger. Balance that with a fraction of the frame.

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

This line is enough:

```text
Keep the location from image 1 exactly as it is: the same camera position and angle, the same framing, the same objects in the same places. Do not add any other people.
```

Do not describe the surroundings. The exceptions are objects that disappear, and the objects used as landmarks for place and scale.

Camera directions (`low angle`, `ground level`) are ignored. image 1 sets the angle. They only matter for a close-up with a blurred background, and the model almost never paints that blur.

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
2. The spot is described through what is visible on image 1.
3. Height is tied to an object.
4. One action, body direction, and gaze.
5. The reference does not contradict the shot. If it does, write `unlike image 2` or pick another file.
6. Details are only story details or details that already broke.
7. Light: amateur snapshot plus a named colour, or a sample picture.
8. Under about 200 words.
9. Run 2–5 seeds at once. For two people and for direction, run 5–10.

## A prompt that was accepted

This failed: a long clothing list, `wet pavement`, `one third of the frame height`, `Cinematic film still`. The figure was large, studio-lit, and standing on the grass.

The accepted prompt:

```text
Place the girl from image 2 into the street from image 1. She runs on the grey paved strip at the very bottom of the frame, right next to the curb of the road, in front of the grass; both boots on this strip. She is at the very left edge of the frame, just entering from the left, running from left to right, mid-stride, one hand on the bag strap, head turned up to the right, lost and panicked. She is fairly small: about one quarter of the frame height, in proportion to the birch tree and the parked car. Amateur snapshot, no special lighting on her: a dark figure in the dim blue dusk, face in shadow, dark reflection on the wet paving. Keep the location from image 1 exactly as it is. Do not add any other people.
```
