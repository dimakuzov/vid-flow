# Черновики графов и манифестов

Тест `npm test` эту папку не читает. Переносить в `workflows/comfy/` только после проверки в ComfyUI.

| Файл | Что | Что нужно до переноса |
| --- | --- | --- |
| `character_outfit_qwen21.json` | Граф одежды: копия `qwen21_character_compositing.json`, id нод те же, `486.switch = false` (холст по image 1), нода 903 удалена | Открыть в ComfyUI, прогнать на одном персонаже, пересохранить через Export (API) под тем же именем, сверить node id с манифестом |
| `character_outfit.bind.json` | Манифест одежды | В контракте нет `forEach`, `library:character`, `match`, `section`: нужны модулю 3 и правка `docs/contracts/graph-binding.md` |
| `first_frame_text.bind.json` | Первый кадр без персонажей и локации, тот же граф сборки, refs/ 0–3 картинки, без картинок — text-to-image | В контракте нет `when.shot`: без него вариант станет «по умолчанию» у кадров с персонажами, пока их approve нет |
