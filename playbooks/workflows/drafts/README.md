# Черновики графов и манифестов

Тест `npm test` эту папку не читает. Переносить в `workflows/comfy/` только после проверки в ComfyUI.

| Файл | Что | Что нужно до переноса |
| --- | --- | --- |
| `character_outfit.bind.json` | Манифест одежды к настоящему графу `workflows/comfy/character_outfit_qwen21.json` (id нод сверены) | В контракте нет `forEach`, `library:character`, `match`: доске нужен обход по персонажам кадра |
| `final_h3_base_reference.md` | Финал H3 от базового low-res H3-ролика (шаблон `create_final_video_using_base_reference`) | Ответы пользователя на вопросы в файле |
| `first_frame_text.bind.json` | Первый кадр без персонажей и локации, тот же граф сборки, refs/ 0–3 картинки, без картинок — text-to-image | В контракте нет `when.shot`: без него вариант станет «по умолчанию» у кадров с персонажами, пока их approve нет |

## Krea 2: граф локации с нуля

Граф пользователя уже лежит в `workflows/comfy/location_krea2_api.json`, манифест — `workflows/comfy/location_krea2.bind.json` (тест нод проходит). В черновики переносить нечего. Ниже — как пересохранить граф, если он поменяется.

1. В ComfyUI открыть граф Krea 2 (столовая, `The_dining_room`). Проверить, что прогон в ComfyUI проходит.
2. Ноды, которые нужны доске (id сейчас):

   | id | Тип | Поле, которое пишет доска |
   | --- | --- | --- |
   | `61` | `PrimitiveStringMultiline` (Text String) | `value` — весь `prompt.md` |
   | `66` | `TextEncodeQwenImageEditPlus` | `image1` — удаляется, если картинки нет |
   | `67` | `LoadImage` | `image` — первый файл `refs/` или общий вид из `data/locations/` |
   | `49` | `ResolutionSelector` | `aspect_ratio` = `9:16 (Portrait Widescreen)` |
   | `54` | `KSampler` | `seed` — случайный |
   | `29` | `SaveImage` | `filename_prefix` = `frameboard/location/{shotId}_krea2` |

   LoRA (`60`, `65`), переключатель `63`, шаги, cfg, сэмплер доска не трогает: их меняют в ComfyUI.
3. Сохранить в формате API: меню **Workflow → Export (API)** (в старом интерфейсе — включить Dev mode в настройках и нажать **Save (API Format)**). Имя файла — `location_krea2_api.json`.
4. Положить файл в `playbooks/workflows/comfy/`, заменив старый.
5. Если id нод поменялись — вписать новые в `location_krea2.bind.json` (поле `node` в `slots`). Удалили `LoadImage` — убрать первый слот и вход `view`.
6. `npm test`: тест манифестов скажет, какой ноды или поля не хватает.

