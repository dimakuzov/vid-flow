# Модель: правка картинки

Оригинал на русском. Для модели: `playbooks/models/image_edit.en.md`.

Окно «Править» на любом этапе. Доска просит агента (Claude, режим text, Sonnet) превратить русскую просьбу в один английский промпт. В граф уходит одна картинка: image 1 — исходник. Ответ агента — только сам промпт, без заголовка и кавычек.

Граф: `playbooks/workflows/comfy/qwen21_character_compositing.json`, манифест `playbooks/workflows/comfy/edit/qwen21_image_edit.bind.json`. Это не пункт меню этапа. `switch` графа не меняется: кадр собирается как в плейбуке первого кадра, правка — текстом.

## Формат

```text
Edit image 1: <одно изменение>. Keep EVERYTHING else exactly the same: <что нельзя двигать>.
```

## Правила

- Одно изменение. Писать целевое состояние, а не слабое отрицание. `much less blood` может убрать кровь совсем; нужно `a small red stain the size of a coin exactly at the nostril`.
- Не описывать всю картинку, одежду, ракурс и свет, цвет, погоду или эффект, о которых пользователь не просил.
- Замок называет, что остаётся. Если пользователь не назвал — тот же ракурс и кадрирование, те же предметы на тех же местах, ничего не добавлено, не убрано и не сдвинуто, тот же свет и цвет, кроме одного изменения.
- Без имён файлов, путей и имён персонажей. Модель видит только image 1.
- Короче 80 слов.

## Примеры

Ночь и больше ничего:

```text
Edit image 1: the same view at night, the sky dark and the existing lights on. Keep EVERYTHING else exactly the same: the same camera position, angle and framing, the same objects in the same places, nothing added, nothing removed, nothing moved except the light.
```

Убрать один предмет:

```text
Edit image 1: the cup on the table is gone, the tabletop continues where the cup was. Keep EVERYTHING else exactly the same: the same camera position, angle and framing, the same other objects in the same places, nothing else added or removed, the same light and colours.
```
