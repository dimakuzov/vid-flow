# Model: Krea 2 location

A new location from text. Graph `playbooks/workflows/comfy/location_krea2_api.json`, manifest `location_krea2` (stage `location`, menu item "Location from scratch: Krea 2 from text"). When to pick it and when to pick `location_views`: `playbooks/stages/location.en.md`, section "Which graph".

## The model

Krea 2 Turbo is a 12B DiT with a Qwen3-VL 4B text encoder and the Qwen Image VAE. Turbo is distilled to 8 steps and runs without CFG [1][2][3]. It was trained mostly on long, dense captions [4].

In the graph:

| Node | What | Who changes it |
| --- | --- | --- |
| `61` | prompt text | the board: the whole `prompt.md` |
| `67` → `66.image1` | reference picture | the board: the first file in `refs/`, else the general view from `data/locations/`; if there is neither, the node is removed and the run is plain text-to-image |
| `49` | 2 MP, aspect ratio | the board sets `9:16 (Portrait Widescreen)` |
| `54` | 8 steps, cfg 1, euler / simple | the board sets a random seed |
| `60`, `65`, `63` | LoRA `krea2_darkbrush` 0.5 and `V67_Interior_design` 0.5, on/off switch | only the user, in ComfyUI |
| `29` | save | prefix `frameboard/location/{shotId}_krea2` |

There is no negative prompt: `ConditioningZeroOut` and cfg 1. Everything you need goes into the positive prompt.

### The picture is meaning, not pixels

The picture goes into Qwen3-VL together with the text. Krea 2 takes its meaning and style and draws a new image; it does not edit the picture [5]. The room on the reference will not be kept: different layout, different windows. If you need the same room from another angle, use the `location_views` graph. Here the reference is for mood, an object, or a material (in the user's graph it was a table).

The graph takes one picture: the first file in `refs/`. A second reference (in ep2, a photo of a faceted glass next to the canteen photo) is not sent. Describe that object in words: `a faceted Soviet glass of strong tea in a metal holder`.

### Shot size

The approved location becomes the background of the first frame as it is. Write the camera for the shot size from the first words of the shot text; the user message wins. Long shot: `wide composition, eye level`, the whole space. Medium shot: `eye level, about two metres from <the spot>`, what stands behind the people at the size it will have behind a person seen from the waist up, the lower part of the frame free. Close-up: `close view of <part of a wall, a window>`, a fragment is enough. Name the place for the people: `the empty chair in the center of the frame`.

## `prompt.md` template

One coherent paragraph in English, no lists, no markup [6]. No `## …` headings: the graph has one branch.

```text
(Interior design:1.1), IntemporalDesign, structural framing, surface treatment, furnishings arrangement, lighting strategy, color palette, ornamental language, spatial rhythm, material juxtaposition, era-informed styling

<Type and scale of the space, era and place>. <Walls, ceiling, floor, windows, doors: colors and materials>. <The main object and its details>. <Other objects, each with its own color and material>. <Light: sources, time of day, color temperature>. <Small imperfect details>. Empty room, no people. Photorealistic, <lens>, <camera height and framing>, <film/color>.
```

The first line is the trigger words of the `V67_Interior_design` LoRA from the user's graph. Keep it as is. For a street or a yard (not an interior) you may drop it; the user can also switch the LoRA off in ComfyUI (node `63`).

## What works

- **Long and specific.** Krea 2 fills in a short prompt by itself, and every run goes somewhere else. The more detail (material, color, light, composition), the narrower the spread [4][7]. A series location needs a narrow spread: 80–200 words.
- **Concrete colors and materials:** `light blue-gray walls`, `solid walnut`, `worn linoleum with a brown parquet pattern`, not `nice walls`, `wooden table` [6][8].
- **Name the era and place:** `a Soviet 1970s Khrushchyovka kitchen`, `a Moscow university corridor in the 1980s`. A named era or medium reorganizes the whole image around it [9].
- **Keep each object with its own attributes,** in one sentence: `a long walnut table with turned legs and a dark knot running down the center` [6].
- **Imperfect details** against the polished AI look: `chipped enamel on the sink`, `a faded calendar on the wall`, `scuffs on the door frame` [9].
- **Camera in words:** `35mm lens, wide composition, eye level`, `low angle from the doorway` [8].
- **Light by source:** what is lit, from where, and in what color. Krea 2 handles two lights in one frame well (daylight window and warm candles in the example below).
- **Text to render goes in quotes:** `a sign that reads "OPEN"` [6]. The board rejects Cyrillic in `prompt.md` (a line with 5+ Russian letters fails the run), so write signs in Latin letters or leave them blank.
- A small text change moves the image a lot. When comparing two prompts, look at several variants, not one [10].

## Avoid

- Comma lists without sentences, JSON, markdown. One paragraph [6].
- A long list of what is not there. There is no negative prompt, and `no pool, no lamp, no TV` can bring those objects in. One closing `Empty room, no people.` is fine.
- Describing the reference to "keep" the room. Keeping is not Krea 2's job, see "The picture is meaning".
- New weights like `(word:1.3)`. Official Krea 2 material does not use them. The trigger line with `(Interior design:1.1)` comes from the user's working graph and stays.
- People. The location is empty; the `first_frame` stage places the characters.
- Shallow depth of field. The background must stay sharp for the next stages.

## Example

The prompt from the user's graph (dining room), used as is:

```text
(Interior design:1.1), IntemporalDesign, structural framing, surface treatment, furnishings arrangement, lighting strategy, color palette, ornamental language, spatial rhythm, material juxtaposition, era-informed styling, modern furniture, antique furniture, v67_victorian

A spacious dining room inside a hillside house, high ceilings with subtle crown molding, light blue-gray walls, elegant refined interior, no view of the pool. A long rectangular dining table made entirely of solid walnut wood, one uniform material top to bottom, no inlay, no contrasting materials, dark wood base with turned legs. The wood grain flows lengthwise along the table, except for one continuous knotted streak running down the center from end to end, where the grain twists into a dark, tightly whorled knot pattern. Ten upholstered cream-colored curved-back dining chairs with dark wood legs surround the table. A chandelier fitted with candles hangs above the table. One end of the room lit by flat, cool daylight from a window, the other end glowing with warm flickering candlelight, the two light qualities meeting across the tabletop. A wooden console table against the wall beneath framed artwork, a large vase with greenery, flanked by brass wall sconces. Wide-plank wood floor, large patterned area rug, tall curtained doorway to the side. Photorealistic, 35mm lens, wide composition, cinematic lighting contrast
```

A draft for the series (not yet checked by a run):

```text
(Interior design:1.1), IntemporalDesign, structural framing, surface treatment, furnishings arrangement, lighting strategy, color palette, ornamental language, spatial rhythm, material juxtaposition, era-informed styling

A small kitchen in a Soviet five-story apartment block in the late 1970s, low ceiling, walls painted pale green up to shoulder height and whitewashed above. A narrow window with a white wooden frame and a gauze curtain looks onto bare autumn trees. Along the left wall stand a white enamel gas stove with four burners and a chipped edge, a small white refrigerator with rounded corners and a chrome handle, and a cast-iron sink with a single brass tap. A square table with a worn oilcloth in a faded red check pattern stands by the window with two wooden stools. A tin kettle on the stove, a jar of pickled cucumbers on the windowsill, a tear-off calendar on the wall. Brown linoleum floor with a parquet print, worn pale in front of the stove. Flat grey overcast daylight from the window, a bare bulb under a glass shade switched off. Empty room, no people. Photorealistic, 28mm lens, eye level from the doorway, wide composition, muted natural colors.
```

## Before the run

1. The space is new, or a fresh variant for the library is needed: Krea 2. The same room from another point: `location_views`.
2. One English paragraph after the trigger line, 80–200 words.
3. Every object has a color and a material. The era is named.
4. Light by source, camera in words.
5. End with `Empty room, no people.` No people, no shallow depth of field.
6. A picture in `refs/` only if a meaning reference is needed; the first file by name is the one that goes.

## Sources

1. Krea, "Krea 2 Open-Source: RAW and Turbo". https://www.krea.ai/krea-2-open-source
2. krea-ai/krea-2, README: Turbo is 8 steps, CFG 0. https://github.com/krea-ai/krea-2
3. ComfyUI Wiki, "Krea 2 Open Source". https://comfyui-wiki.com/en/news/2026-06-22-krea-2-open-source-text-to-image
4. Krea, "Krea 2 technical report" (long training captions, Qwen3-VL as text and image encoder). https://www.krea.ai/blog/krea-2-technical-report
5. RunComfy, "Krea 2 Turbo ComfyUI workflow" and the Krea 2 Reference overview (the picture goes in as meaning, the model redraws). https://www.runcomfy.com/comfyui-workflows/krea-2-turbo-comfyui-workflow-fp8-diffusion-qwen-image-generation
6. krea-ai/krea-2, `docs/prompting.md` and `docs/expansion.txt` (natural language, one paragraph, text in quotes). https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md
7. Krea, "Explorative prompting with Krea 2". https://www.krea.ai/blog/explorative-prompting-krea-2
8. fal.ai, "Krea 2 Prompting Guide + Examples". https://fal.ai/learn/tools/krea-2-prompting-guide
9. fal.ai, "How To Use Krea 2 Open Source". https://fal.ai/learn/tools/how-to-use-krea-2-open-source
10. "Krea 2: Run the New 12B Open-Weights Image Model" (fix the seed when comparing prompts). https://www.qwe.edu.pl/tutorial/krea-2-12b-open-weights-image-model/
