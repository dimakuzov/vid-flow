# Stage: location

Shot-specific location with no people. The general view comes from the series library, or the location is drawn from text. The board runs one graph here: Krea 2 from text.

Prompts: `playbooks/models/krea2_location.en.md`.

## Depends on the library

```text
data/locations/{locationId}/
  view.png          # one source image for the location
  description.txt   # objects, colors, and materials that are actually on view.png
```

`{locationId}` is the name from the episode `scenario.md` (`night_cafe`, `street_rain`). The shot lives in `data/episodes/{episodeId}/shots/{shotId}/location/`. A picture in `refs/` is only a meaning reference. Do not mix old variants from subfolders.

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
| `{locationId}_view.png` | optional meaning reference, a copy of `view.png` from the library. The first file by name is the one that goes |

## Which graph

The stage "Workflow" menu has one option: `location_krea2` — "Location from scratch: Krea 2 from text". It does not need a picture. A picture in `refs/` is only a meaning reference: Krea 2 draws the room anew, it does not edit the picture.

## Location from the library

The shot's location name is the `- location:` line in `shot.md`: a folder in `data/locations/`. Under "Send to agent" a dropdown lists those folders. A choice changes only that line; files in `refs/` stay as they are. "Create a location" makes an empty folder `data/locations/{name}` (latin letters, digits, `_` and `-`) and writes that name into the shot. The user puts the general-view picture in the folder themselves.

The "From the library" button next to "References" (on this stage only) lists the `data/locations/` folders with a thumbnail and puts the general view into `refs/` as `{locationId}_view.png`. An existing file is not overwritten. The graph takes the first file in `refs/`, so the chosen location becomes the input right away. The "Write into the shot" checkbox also changes `- location:` in `shot.md`. After such a pick the agent does not rebuild `refs/` (`agent_touch.json`).

## The location is the background of the first frame

The approved location becomes image 1 of the first frame and stays there as the background, unchanged. The first-frame prompt does not move the camera. So shoot the location the way the shot needs it. Take the shot size from the first words of the shot text (`Close up`, `Medium shot`, `Long shot`); the user message wins.

| Shot size | What the location shows |
| --- | --- |
| Long shot | The whole space where the action happens, eye level. The spot for the people is free and visible |
| Medium shot | The view from about two metres from the spot where the people will be: what stands behind them (window, desk, board) at the size it will have behind a person seen from the waist up. The lower part of the frame is the place for the people. In ep2 the professor's medium shot worked at once because the location was already framed at the podium's distance; the girls at the window (s07) took longer because the location was a full-height window and the model kept redrawing it |
| Close-up | A fragment of the place is enough: part of a wall, a window, a few desks, seen close. In ep2 a close-up on a plain wooden panel was accepted on the first run, while close-ups on a wide view of the hall came out as wide shots |

Write the empty spot into the prompt: `the empty chair in the center of the frame`, `the window on the right half of the frame, the floor in front of it free`. Do not name the person who will use it, and do not frame the shot from behind their shoulder. Write only the objects that matter for the action: they are the landmarks the first frame ties scale to.

Shots in the same location keep the same room: put the approved view of that room into `refs/` and describe the new point of view in the text, do not invent a new room for every shot.

## Order

1. Take `view.png` and `description.txt` from the library, when the location has them.
2. Write one English paragraph in `prompt.md` (`playbooks/models/krea2_location.en.md`). Put the general view into `refs/` when the same room is needed from another point.
3. The board runs the graph and puts the results in `output/`.
4. Pick the best. Change light, objects and cleanliness on the next round with a short edit of the paragraph. Do not rewrite the whole prompt.
5. Put the chosen file in `approve/{locationId}_{shotId}.png`.

No people in frame. If the base image has people, say in the paragraph that the room is empty.
