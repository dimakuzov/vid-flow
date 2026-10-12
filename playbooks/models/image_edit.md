# Модель: правка картинки

Оригинал на русском. Для модели: `playbooks/models/image_edit.en.md`.

Окно «Править» на любом этапе. Граф один: `playbooks/workflows/comfy/qwen21_character_compositing.json`. Им же делается улучшение, когда поле пустое. Это не пункт меню этапа. Картинку агент не смотрит.

Пустое поле доска пишет сама, без Claude:

```text
Edit image 1: slightly improve the textures and the fine detail only. The camera position, angle and framing must not change. Keep the same objects in the same places, nothing added, nothing removed, nothing moved, and the same light and colours.
```

Если в поле есть текст, его собирает Claude Haiku 5.5 (`claude-haiku-5-5`), без картинки. Сначала просьба пользователя, потом сохранение всего, чего он не касался. Положение камеры, угол и кадрирование не меняются никогда. Свет в замок не входит, если просили сменить свет. Если просили убрать, добавить или сдвинуть предмет — сначала это, потом «остальные объекты как есть», без фразы «ничего не добавлено и не убрано».

Мегапиксели нового файла — поле в окне. Пусто или то же число, что в графе (нода 13, сейчас 2.3), граф не трогает. Другое число пишется в `megapixels` ноды 13. Сам файл графа не меняется.
