# Model: Qwen location

English copy for the model. Russian original: `playbooks/models/qwen_location.md`.

Prompts for a shot-specific location. Where files go: `playbooks/stages/location.en.md`. The simple-angle graph: `playbooks/workflows/location_comfy.en.md`.

Write only about what is on `view.png` and in `description.txt`. Do not add details from the shot text that are not on the reference. The location reference wins over the shot text.

## Shot size

The approved location becomes the background of the first frame as it is: the first frame does not move the camera. Frame it for the shot size from the first words of the shot text; the user message wins.

- **Long shot**: the whole space, eye level, the spot for the people free.
- **Medium shot**: `Move the camera forward` to about two metres from the spot where the people will be. What stands behind them (window, desk, board) at the size it will have behind a person seen from the waist up; the lower part of the frame is free for them.
- **Close-up**: `Turn the camera to a close-up`: a fragment of the place (part of a wall, a window, a few desks) is enough. Do not write the person who will stand there.

Name the place for the people: `the empty chair in the center of the frame`, `the window on the right half, the floor in front of it free`.

## Which prompt

| Task | Prompt |
| --- | --- |
| A. A new simple angle | The four branches below. Do not describe the light |
| Hard angle | Two references: our location and someone else's camera |
| B. Edit of a finished picture | `Edit image 1`, numbered steps, then the Keep the composition paragraph |

No people in the frame.

## A. Four branches

Order: the camera command first, then what must be in frame. End with a short line that this is the same location and there are no people.

The Multiple-angles LoRA responds best to this vocabulary. Use one or two commands, not a cascade:

- `Rotate the camera 45 / 90 / 180 degrees to the left / right.`
- `Move the camera forward / back / down / up.`
- `Turn the camera to a close-up / wide-angle lens / top-down view / low-angle view / aerial view.`

Branches:

1. **simple** — one sentence: shot size and where we look. Only for a close angle.
2. **objects** — only things on the reference, with their real colors and materials from `description.txt`. This is the branch that most often gets approved.
3. **camera** — one or two commands from the vocabulary, plus `Keep the same room, no people.` For a simple turn.
4. **camera + objects** — branch 3, then `In frame:`, then branch 2.

An objects prompt that was approved with no further edit:

```text
The narrow bed along the wall seen from the front and slightly above: white sheet,
flat white pillow, the small oriental rug-napkin and a crumpled blanket, folded dark
trousers lying on the bed, the blue-beige patchwork wallpaper behind, the parquet
floor and the edge of the green-blue rug at the bottom. No people.
```

If the reference is shot from above, one step often leaves the camera at the ceiling. Make an eye-level in-between view first, then turn from that. A 180° turn plus a height change is not an A task.

Empty latent 768×1344, output 9:16. Four variants per run. Do not run empty extra branches.

### In `prompt.md` on the board

Each branch is its own section with a `## <branch>` heading. The board sends each section to its branch of the graph and does not run a branch without a section.

```md
## simple
Medium shot of the bed from the front, eye level. Same bedroom, no people.

## objects
The narrow bed along the wall seen from the front: white sheet, flat white pillow, the blue-beige patchwork wallpaper behind. No people.

## camera
Rotate the camera 45 degrees to the right. Keep the same room, no people.

## camera_objects
Rotate the camera 45 degrees to the right. In frame: the narrow bed, white sheet, the patchwork wallpaper. Keep the same room, no people.
```

Sections: `simple`, `objects`, `camera`, `camera_objects`. Without headings the whole text goes to all four branches (the old behaviour: the four variants differ only by seed). Text before the first heading and other section names are errors. Return only these sections, in English.

## Hard angle

image 1 is our location. image 2 is any photo with the camera you want. The location is moved into the other composition. The contents of image 2 are banned.

1. `Recreate the <location> from image 1 from the camera angle and composition of image 2.`
2. **Camera position:** where the camera stands and where it looks, through objects: what is at the bottom edge, what runs off to the right, what is at the top. `low angle` alone is not enough.
3. **Keep everything from image 1 exactly:** materials, colors, and objects from `description.txt`, plus the light and the palette.
4. The role of image 2: `Use image 2 only for the camera angle and framing, do not copy its …` and a list of what is extra in that photo.

```text
Recreate the lecture hall from image 1 from the camera angle and composition of image 2.

Camera position: low, at floor level at the front end of the seating, right next to the
first row of desks, looking diagonally up and across the tiered rows. The curved backs of
the front benches are very close to the camera in the lower left foreground and sweep away
to the right, each following row stepping higher behind the previous one, forming the arc
of the amphitheater. The upper rows and the tall windows are at the top of the frame, the
floor of the front aisle is visible in the lower right corner.

Keep everything from image 1 exactly: the dark aged wooden benches and desks, the
wood-paneled wainscoting, the pale grey-blue upper walls, the tall white-framed windows,
the spherical milk-glass pendant lamps, the grey stone floor, the dim overcast lighting
and the muted desaturated colors. Use image 2 only for the camera angle and framing, do
not copy its projector, parquet floor, clock, radiators or bright lighting.
```

This pass usually needs the cleanup paragraph from section B.

## B. Edit

Qwen Image 2.1 edit. Light, season, an object, and cleanup are separate passes. Do not combine them with a camera turn.

1. `Edit image 1.`
2. What to keep: a list of the real objects in the frame.
3. What to do: numbered steps, one action each. A new object uses `add`, not `replace`.
4. The role of each reference: `Put exactly the same bus stop as in image 4 — same shape, structure, roof. Do not redesign it.`
5. The join: `Relight the new elements to match image 1. Match the perspective and scale of image 1. Natural photographic look, no collage effect.`
6. `The scene is completely empty: no people. If images 2, 3 or 4 contain people, remove them.`
7. The cleanup paragraph, copied as written:

```text
Keep the composition, camera angle, framing and all objects from image1. Every object
must stay the same object, with the same type, shape, size, design and position.
Do not replace, reinterpret or redesign any other object. Only improve how each object
is rendered: remove noise, blur and compositing artifacts, and render crisp surfaces,
fine textures, clean reflections and highlights that closely match the original
materials and colors. Keep the original lighting from image1, clean shadows without noise.
```

A short line such as `This is a dark wooden door.` locks an object the model wants to redraw.

Short edits that already worked:

- Light: `Make the image darker, as on a heavy overcast day just before dusk.`
- Season: `Remove all leaves: the tree branches stay in place but are bare. The grass is dull and faded.`
- An extra object: `Remove the white pedestrian crossing markings completely. In their place, continue the same dark wet asphalt.`
- Geometry: `Correct the building geometry: straight vertical walls, straight horizontal lines, evenly aligned windows and balconies.`

A long description of a room that is already in image 1 is read as a task, and the model redraws the location. Describe only the change. Everything else is “keep”.

## Do not write

- Do not describe a location that is already in image 1.
- Do not describe the light on pass A.
- Do not take details from the shot text when they are not on the reference.
- Do not combine a large turn, a height change, and a shot-size change in one A command.
- Do not ask for shallow depth of field. Leave the background sharp.
- Do not feed image 2 without a role. The model will take objects and light from it.
- Do not put every edit in one paragraph. Use numbered steps.

## Before a run

1. Simple angle → A. Hard angle → two references. Edit → B.
2. The prompt contains only what is on `view.png` and in `description.txt`.
3. A uses one or two camera commands and no light change.
4. B names every image role, numbers the steps, and ends with the Keep the composition paragraph.
5. No people in frame.
6. Output is 9:16. A makes four variants. B makes two to five seeds. Edit the best one next. Do not rewrite everything.
