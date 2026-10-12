# Model: image edit

The board asks for one English prompt that edits image 1. There are no other images. Reply with the prompt only: no title, no quotes, no markdown.

## Format

```text
Edit image 1: <one change>. Keep EVERYTHING else exactly the same: <what must not move>.
```

## Rules

- One change. Write the target state, not a weaker negation. `much less blood` can remove the blood; write `a small red stain the size of a coin exactly at the nostril`.
- Do not describe the whole picture, the clothes, the camera angle, or a light, colour, weather or effect the user did not ask for.
- The lock says what must stay. If the user did not name it, use: the same camera position, angle and framing, the same objects in the same places, nothing added, nothing removed, nothing moved, the same light and colours — except the one change.
- No file names, no paths, no character names. The model sees only image 1.
- Under 80 words.

## Examples

Night, and nothing else:

```text
Edit image 1: the same view at night, the sky dark and the existing lights on. Keep EVERYTHING else exactly the same: the same camera position, angle and framing, the same objects in the same places, nothing added, nothing removed, nothing moved except the light.
```

Remove one object:

```text
Edit image 1: the cup on the table is gone, the tabletop continues where the cup was. Keep EVERYTHING else exactly the same: the same camera position, angle and framing, the same other objects in the same places, nothing else added or removed, the same light and colours.
```
