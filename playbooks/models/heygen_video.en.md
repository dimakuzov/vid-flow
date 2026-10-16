# Model: HeyGen Video 1.0 (Comfy Cloud)

English copy for the model. Russian original: `playbooks/models/heygen_video.md`.

The final for a dialogue: two (or more) people talk to each other and their lips must move on their own lines. Graph `playbooks/workflows/comfy/heygen_video_i2v_api.json`, node `HeyGenImageToVideoNode`, Image to Video from the approved first frame. Runs only in Comfy Cloud and costs credits (about 45.3 per 10 s, 5–15 s); the board sends it only after the user ticks the permission box on the stage page.

`prompt.md` is the whole `model.prompt`: one paragraph in English, no headings, no sections. The board adds nothing to it.

## How to write it

1. **A script, in order.** The model reads literally, so actions go in the order they happen: holds her hand, lets go, speaks, takes it again, turns. Do not summarise; do not jump back in time.
2. **Every person described by look and position, as character1 and character2.** `On the left is character1, a young woman with long dark hair and round glasses, in a green tweed coat; on the right is character2, a young woman with a long brown braid, in a black leather jacket.` Then keep those labels. A production name mixes the model up, because it cannot tell which picture it belongs to. Take the look from the first frame prompt in the task; do not invent clothes.
3. **Lines in quotes, tied to the character label.** `character1 talks animatedly and says in a lively, dreamy voice: "...like to imagine things."` The model speaks exactly what is in the quotes. An English line of `speech.md` goes in word for word, in its order; the board refuses to run when it is missing. A line written in Cyrillic is written here in English; do not copy the Cyrillic and do not translate the line into Russian.
4. **The lips line.** `Each girl's lips move only on her own line, in sync with every word; while one speaks, the other keeps her mouth closed.` (two men: `Each man's lips…`; mixed: `Each person's lips…`). This is the guide's own advice for two speakers.
5. **The Audio block at the end.** Without it the model picks the sound itself, music included. Name the sounds and finish with `No music.` Example: `Audio: their footsteps on dry fallen leaves, the rustle of the bag, a quiet night park room tone with a faint wind in the bare branches. No music.`
6. **Optional opening:** `Start exactly from the first frame and keep both girls, their outfits and the lighting as shown.` The node already uses the picture as the first frame; the sentence only reminds the model not to change people and clothes.

Camera: say it once, plainly (`Medium long tracking shot: the camera moves backward smoothly at walking pace…`, or `Static shot, fixed camera.`). Add `Realistic, natural movement, real skin texture.` before the Audio block.

Duration is not written in the prompt: the board takes the length of the approved preview (rounded, held to 5–15 s).

## Example that worked

```text
Start exactly from the first frame and keep both girls, their outfits and the lighting as shown. Medium long tracking shot: the camera moves backward smoothly at walking pace, keeping both girls in front of it, in a moonlit autumn park at night, bare black trees, fallen leaves on the path, cold blue moonlight with warm orange glow of leaves in the background. On the left is character1, with long dark hair and round glasses, in a green tweed coat with a dark fur collar and cream trousers; on the right is character2, with a long brown braid, in a black leather jacket and a dark brown skirt, a black canvas bag on her shoulder. They walk side by side toward the camera. character1 talks animatedly, gesturing with one hand, and says in a lively, dreamy voice: "...like to imagine things. I like fantasy fiction..." character2 walks beside her, not listening; in the first second her hand slides into the open bag and starts rummaging through it. Then character2 stops dead, her hand frozen inside the bag, her eyes wide, her lips parted, her expression one of stunned shock and disbelief, her natural skin tone unchanged, and she says in a shaky, panicked whisper: "Oh my God... I've lost my diary!" Julia takes one more step, then slows and turns toward character2, her mouth closed. The shot ends on character2 standing completely still. Each girl's lips move only on her own line, in sync with every word; while one speaks, the other keeps her mouth closed. Realistic, natural movement, real skin texture. Audio: their footsteps on dry fallen leaves, the rustle of the bag, a quiet night park room tone with a faint wind in the bare branches. No music.
```

## Before sending

1. One paragraph, English, in the order of events.
2. Each person: look + position (left / right), then the name.
3. Every line of `speech.md` in quotes, word for word, tied to its speaker, in order.
4. The lips line.
5. The Audio block with `No music.` at the end.
6. No file names, no `@img` labels, no section headings.
