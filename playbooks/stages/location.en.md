# Stage: location

English copy for the model. Russian original: `playbooks/stages/location.md`.

Shot-specific location with no people. The general view comes from the series library. The angle and edits for this shot are built here.

Prompts: `playbooks/models/qwen_location.en.md`. How to run the angle graph: `playbooks/workflows/location_comfy.en.md`.

## Depends on the library

```text
data/series/locations/{locationId}/
  view.png          # one source image for the location
  description.txt   # objects, colors, and materials that are actually on view.png
```

`{locationId}` is the name from `scenario.md` (`night_cafe`, `street_rain`). One pass uses one `view.png`. Do not mix old variants from subfolders.

Extra object photos (a bus stop, a lantern) stay in that folder and are copied into the shot `refs/` only when an edit uses them.

## Shot contract

```text
shots/{shotId}/location/
  refs/  output/  approve/
  prompt.md  llm_notes.md  refs.md  workflow.md  status.json
```

`workflow.md` is an optional note. It can stay empty.

`approve/` holds one chosen file. It goes to `first_frame`. Name: `{locationId}_{shotId}.png`.

There is no `env/` folder. Older notes called this file `S<number>/env/env.png`.

## What goes in refs/

| File | Role |
| --- | --- |
| `{locationId}_view.png` | image 1, our location. A copy of `view.png` from the library |
| `angle.png` | image 2 only for a hard angle change: someone else's picture with the camera you want. Do not copy its objects or light |
| object photo | image 3, 4… only on an edit pass, when an object must match that photo |

## Which pass

| Task | Pass |
| --- | --- |
| A simple turn, a different shot size, the camera a little higher or lower | A. Graph `playbooks/workflows/comfy/location_views_multiple_angles.json` |
| About 180° or a large height change | Make an eye-level in-between view first, then another A step. If it still fails, use the two-reference Qwen Image 2.1 angle pass |
| Remove or add an object, change light or season, clean the picture | B. A separate Qwen Image 2.1 edit. That graph is not in the repo |

Do not change the light on pass A. The model almost never paints shallow depth of field. Leave the background sharp.

The **objects** branch is the one that most often gets approved: the frame described through things that are on the reference. The **camera** branch is for a simple turn. The **simple** branch is only for a close angle.

## Order

1. Take `view.png` and `description.txt` from the library.
2. Pick the pass from the table.
3. For A, run the four branches and put the results in `output/`: `{shotId}_v1_simple.png`, `{shotId}_v2_objects.png`, `{shotId}_v3_camera.png`, `{shotId}_v4_camera_objects.png`.
4. Pick the best. If one A run misses the angle, do not keep spinning it. Use an in-between view or the hard-angle pass.
5. Change light, objects, and cleanliness on a later B pass. Do not rewrite the whole prompt.
6. Put the chosen file in `approve/{locationId}_{shotId}.png`.

No people in frame. If the base image has people, remove them in a separate edit first.
