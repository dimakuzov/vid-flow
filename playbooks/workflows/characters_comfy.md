# Workflow: characters (Comfy)

Оригинал на русском. Для модели: `playbooks/workflows/characters_comfy.en.md`.

Персонаж кадра — правка одежды Qwen Image 2.1. Граф: `playbooks/workflows/comfy/character_outfit_qwen21.json` (формат API). Им сделаны `approve/katya_s07.png` и `approve/lena_s07.png` на teaser s07.

JSON графа не редактировать: в очередь подставляются имена картинок, текст, seed и префикс. `update_comfyui.bat` не запускать. ComfyUI: `http://127.0.0.1:8188/`.

## Граф

| Нода | Что | Значение |
| --- | --- | --- |
| 10 LoadImage | image 1 — персонаж | база из `data/characters/{name}/` или результат прошлого прохода |
| 22 LoadImage | image 2 — образец одежды | `refs/{имя}_clothes.*`. Нет файла — нода в bypass |
| 11 UNETLoader | модель | `qwen_image_2.1_int8_convrot.safetensors`, weight_dtype `default` |
| 12 CLIPLoader | энкодер | `qwen3vl_8b_int8_convrot.safetensors`, type `qwen_image` |
| 13 VAELoader | VAE | `qwen_image_2.1_vae_bf16.safetensors` |
| 14 LoraLoaderModelOnly | LoRA | `qwen2.1\lenovo_qwen21.safetensors`, сила 0.6 |
| 15 QwenImage21Cache | кэш | device `auto`, dtype `default` |
| 16 PrimitiveStringMultiline | текст | шаблон — в `playbooks/models/qwen_image.md` |
| 17 TextEncodeQwenImage21 | энкодер | negative пустой, resolution 1024, `images.image_1` = нода 10, `images.image_2` = нода 22. Латент — со слота энкодера: холст как у image 1 |
| 19 KSampler | сэмплер | seed числом, 25 шагов, cfg 1, euler, simple, denoise 1 |
| 21 SaveImage | файл | `filename_prefix` — `frameboard/{shotId}/{name}_dress` или похожий |

Шаги, cfg, sampler и LoRA не менять.

Нет образца одежды — нода 22 («image 2: образец одежды») в bypass: из промпта уходят нода 22 и ключ `images.image_2` у ноды 17. В тексте image 2 не упоминать. Другие файлы `refs/` в граф не входят.

## Команда

Эту секцию выполняет агент, когда этап кадра — `characters`. Бумаги `prompt.md` недостаточно: прогон идёт, пока у каждого персонажа кадра нет подходящего `approve/{name}_{shotId}.png`.

Один персонаж за проход. Имена персонажей в текст генерации не писать. Старые файлы в `output/` и `approve/` не удалять.

### База

Искать `full_body.png`, `portrait.png`, `side.png` в `data/characters/{Name}/`. Для image 1 нужна одна фигура в полный рост, стоит прямо, светлый фон. Если такого файла нет, взять существующий png этой папки, но не трёхпанельный лист целиком (правая панель, одна фигура). Не брать `_old/` и файлы с `Copy` в имени. Нет своей картинки — остановиться и написать имя недостающего файла, человека не выдумывать.

### Правка одежды

image 1 — персонаж, image 2 — образец одежды из `refs/`. Текст называет только меняемый слой и держит лицо, волосы, позу, кадрирование, свет и фон (шаблон в `playbooks/models/qwen_image.md`).

Результат — одна фигура, стоит, светлый фон, обувь целиком, одежда не развевается.

Если под новым верхом виден низ базы, второй проход берёт результат первого как image 1 и описывает нужный низ и ту же обувь. Пример, который сработал: зелёный сарафан продолжается юбкой ниже колен поверх жёлтой водолазки, серые туфли остаются. Фразы «без брюк» нет.

Если стоп нет из-за обрезки, холст выше исходника: `EmptyLatentImage`, стороны кратны 32, вместо латента энкодера. Промпт продлевает вниз ту же фигуру: голова у верхнего края, обе стопы и простая плоская обувь целиком, уже надетая одежда и волосы остаются. Это не новый человек.

Готовый файл копировать в `output/`. В `approve/{name}_{shotId}.png` класть, когда слои, обувь и волосы совпали с запросом.

### Очередь

Только `http://127.0.0.1:8188/`: `POST /upload/image`, `POST /prompt`, `GET /history/{prompt_id}`, `GET /view`. Если эта оболочка не открывает этот адрес, запрос всё равно ставится отсюда: запиши `data/comfy_queue/<id>.json` со статусом `pending`. Доска на компьютере с ComfyUI сама отправит его и допишет в тот же файл `status`, `files` и `error`. Жди `done` или `error`.

```json
{
  "id": "s07-katya-1",
  "status": "pending",
  "prompt": { "10": { "class_type": "LoadImage", "inputs": { "image": "s07_katya_src.png" } } },
  "uploads": [{ "path": "data/characters/katya/full_body.png", "filename": "s07_katya_src.png" }],
  "saveTo": "data/episodes/teaser/shots/s07/characters/output"
}
```

`prompt` — граф целиком в формате API (номер ноды, `class_type`, `inputs`), как `character_outfit_qwen21.json`. Имя картинки в `inputs` совпадает с `filename` из `uploads`. `saveTo` только внутри `data/`.

Если в ответе `node_errors`, записать имя ноды и текст. Недостающее поле закрыть дефолтом этой ноды. Steps, cfg, sampler и LoRA не менять.

`"status": "done"` в `agent_request.json` ставить, когда approve есть у каждого персонажа кадра. `status.json` не трогать: статус этапа ставит доска. Итог прогона дописать в `run_log.md`. `llm_notes.md` не трогать. Перед заменой `prompt.md` предыдущий текст остаётся в `prompt_history.json`.

## Если что-то не так

| Симптом | Что делать |
| --- | --- |
| Под сарафаном или платьем видны брюки базы | Второй проход: описать юбку как слой, закрывающий ноги, и ту же обувь |
| Нет стоп, кадр обрезан | Продлить ту же фигуру вниз, холст выше |
| Лишняя одежда или каблуки | Чинить входы: обувь и все слои должны быть чётко видны на image 1 и image 2 |
| Одежда с image 2 перенеслась не целиком | Назвать в тексте недостающие детали: цвет, узор, вырез, длину |
| Изменилось лицо, причёска или поза | Проверить, что текст держит их «exactly as in <image1>», и что image 1 — одна фигура |
