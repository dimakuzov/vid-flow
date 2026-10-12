# Model: Qwen outfit

English copy for the model. Russian original: `playbooks/models/qwen_outfit.md`.

An outfit edit for the shot's character. Graph `character_outfit_qwen21.json`, manifest `character_outfit`. Each character gets its own section of `prompt.md`.

## Prompt

A section `## name` in lowercase latin, the same name as in shot.md. An empty section is not regenerated. Text before the first heading and an unknown section name are errors. Do not write character names in the text.

Change only the clothes from the user's request. Face, hair, figure, pose, background, and the other clothes stay as in image 1. Do not describe appearance from memory. Do not write file names.

Image 2 is the garment sample when the user placed `refs/{name}_clothes.*`. Without that file, node «image 2: образец одежды» is bypassed, and the text does not mention image 2: describe the clothes in words.

```md
## lena
Change the coat in image 1 to a dark wool coat, knee length. The shoes, face, hair, figure, standing pose and plain background stay exactly as in image 1.

## mom
```
