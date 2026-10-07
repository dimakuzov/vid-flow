# Черновики графов и манифестов

Тест `npm test` эту папку не читает. Переносить в `workflows/comfy/` только после проверки в ComfyUI.

| Файл | Что | Что нужно до переноса |
| --- | --- | --- |
| `character_outfit.bind.json` | Манифест одежды к настоящему графу `workflows/comfy/character_outfit_qwen21.json` (id нод сверены) | В контракте нет `forEach`, `library:character`, `match`: доске нужен обход по персонажам кадра |
| `final_h3_base_reference.md` | Финал H3 от базового low-res H3-ролика (шаблон `create_final_video_using_base_reference`) | Ответы пользователя на вопросы в файле |
| `first_frame_text.bind.json` | Первый кадр без персонажей и локации, тот же граф сборки, refs/ 0–3 картинки, без картинок — text-to-image | В контракте нет `when.shot`: без него вариант станет «по умолчанию» у кадров с персонажами, пока их approve нет |
