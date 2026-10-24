# Model: Qwen outfit

An outfit edit for the shot's character. Graph `character_outfit_qwen21.json`, manifest `character_outfit`. Each character gets its own section of `prompt.md`.

## Prompt

A section `## name` in lowercase latin, the same name as in shot.md. An empty section is not regenerated. Text before the first heading and an unknown section name are errors. Do not write character names in the text.

Change only the clothes from the user's request. Face, hair, figure, pose, background, and the other clothes stay as in image 1. Do not describe appearance from memory. Do not write file names.

Image 2 is the one clothing reference from `refs/` (not the picture of the person). Without a reference, node «image 2: образец одежды» is bypassed, and the text does not mention image 2: describe the clothes in words. Two clothing references are refused.

```md
## lena
Change the coat in image 1 to a dark wool coat, knee length. The shoes, face, hair, figure, standing pose and plain background stay exactly as in image 1.

## mom
```
