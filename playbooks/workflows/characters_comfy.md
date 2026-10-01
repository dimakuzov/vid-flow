# Workflow: characters (Comfy)

Оригинал на русском. Для модели: `playbooks/workflows/characters_comfy.en.md`.

Два прохода. Одежду меняет edit Qwen Image 2.1. Позу собирает `playbooks/workflows/comfy/character_pose_outfit_qwen.json`: image 1 = одна фигура в одежде кадра, image 2 = скелет, image 3 = лицо. На teaser s07 это дало утверждённые `approve/katya_s07.png` и `approve/lena_s07.png`.

JSON графа не редактировать. В очередь подставляются имена файлов, текст и seed. `update_comfyui.bat` не запускать. ComfyUI: `http://127.0.0.1:8188/`.

## Команда

Эту секцию выполняет агент Cursor и агент Claude, когда этап кадра — `characters`. Бумаги `prompt.md` недостаточно. Прогон идёт, пока у каждого персонажа кадра нет подходящего `approve/{name}_{shotId}.png`.

Один персонаж за проход. Имена персонажей в текст генерации не писать. Старые файлы в `output/` и `approve/` не удалять.

### База

Искать `full_body.png`, `portrait.png`, `side.png` в `data/characters/{Name}/`. Если имени нет, взять существующий png этой папки. Не брать `_old/` и файлы с `Copy` в имени. Нет своей картинки — остановиться и написать имя недостающего файла, человека не выдумывать.

Трёхпанельный лист не кропать в лицо и не подавать как образец позы. Для позы — правая панель, одна фигура в полный рост.

### Правка одежды

Холст как у картинки 1: `ComfySwitchNode.switch` = false, латент со слота энкодера. Шаги, cfg, sampler и LoRA не менять.

| Нода | Значение |
| --- | --- |
| UNETLoader | `qwen_image_2.1_int8_convrot.safetensors`, weight_dtype `default` |
| CLIPLoader | `qwen3vl_8b_int8_convrot.safetensors`, type `qwen_image` |
| VAELoader | `qwen_image_2.1_vae_bf16.safetensors` |
| LoraLoaderModelOnly | `qwen2.1\lenovo_qwen21.safetensors`, сила 0.6 |
| QwenImage21Cache | device `auto`, dtype `default` |
| TextEncodeQwenImage21 | negative пустой, resolution 1024, `images.image_1` = исходник. В тексте есть `<image1>` |
| KSampler | 25, cfg 1, euler, simple, denoise 1 |

Результат — `refs/{name}_outfit.png`: одна фигура, стоит, светлый фон, обувь целиком, одежда не развевается.

Если под новым верхом виден низ базы, второй проход той же фигуры описывает нужный низ и ту же обувь. Пример, который сработал: зелёный сарафан продолжается юбкой ниже колен поверх жёлтой водолазки, серые туфли остаются. Фразы «без брюк» нет.

Если стоп нет из-за обрезки, холст выше исходника: `EmptyLatentImage`, стороны кратны 32, switch true. Промпт продлевает вниз ту же фигуру: голова у верхнего края, обе стопы и простая плоская обувь целиком, уже надетая одежда и волосы остаются. Это не новый человек.

### Скелет

`refs/{name}_pose.png` — та же одна фигура. DWPreprocessor: hand, body и face = enable, resolution 1024, bbox `yolox_l.onnx`, pose `dw-ll_ucoco_384_bs5.torchscript.pt`, scale_stick disable.

На превью должны быть обе руки, кисти, обе ноги и обе стопы. Стоп нет — вернуться к продлению кадра. Сборку не запускать.

### Сборка

Файл графа не переписывать. В API подставить установленные модели. Имя UNET bf16 из JSON на этой машине отсутствует.

| Нода | Значение |
| --- | --- |
| UNETLoader | `qwen_image_edit_2511_fp8mixed.safetensors`, weight_dtype `default` |
| CLIPLoader | `qwen_2.5_vl_7b_fp8_scaled.safetensors`, type `qwen_image`, device `default` |
| VAELoader | `qwen_image_vae.safetensors` |
| LoraLoaderModelOnly | `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors`, сила 1.0 |
| ModelSamplingAuraFlow | shift 3.1 |
| CFGNorm | 1.0 |
| ImageScaleToTotalPixels | lanczos, megapixels 1.0, `resolution_steps` 1 |
| VAEEncode | пиксели масштабированного скелета, не фото одежды |
| KSampler | seed числом, 4 шага, cfg 1, euler, simple, denoise 1 |
| NEGATIVE | текст из графа не заменять. При cfg 1 он не действует |

`resolution_steps` обязателен у установленной ноды. Без него очередь отвечает 400 на нодах масштаба. Строку `randomize` в KSampler не слать: это виджет интерфейса, не вход API.

image 1 = `refs/{name}_outfit.png`. image 2 = `refs/{name}_pose.png`. image 3 = `refs/{name}_face.png`.

Промпт сборки одежду и внешность не описывает. Шаблон — в `playbooks/models/qwen_image.md`. Поза в тексте совпадает со скелетом, а не с действием кадра, если для этого действия нет своей пластины. Два прогона, новые seed. Лучший файл в `output/`. В `approve/{name}_{shotId}.png` класть только если слои, обувь и волосы совпали с образом.

Очередь только на `http://127.0.0.1:8188/`: `POST /upload/image`, `POST /prompt`, `GET /history/{prompt_id}`, `GET /view`. Если в ответе `node_errors`, записать имя ноды и текст. Недостающее поле закрыть дефолтом этой ноды. Steps, cfg, sampler и LoRA не менять.

`status.json` этапа ставить в `done`, когда approve есть у каждого персонажа кадра. Итог прогона дописать в `run_log.md`. `llm_notes.md` — только рекомендация пользователя, её журналом не затирать. Перед заменой `prompt.md` предыдущий текст остаётся в `prompt_history.json`.

## Если что-то не так

| Симптом | Что делать |
| --- | --- |
| 400, `resolution_steps` missing на ImageScaleToTotalPixels | Поставить 1 и повторить ту же очередь |
| На скелете нет стоп | Продлить тот же кадр вниз. Сборку не запускать |
| Под сарафаном или платьем видны брюки базы | Второй edit: описать юбку и ту же обувь |
| На сборке несколько людей или сетка | image 1 и image 2 были листом. Подать одну фигуру |
| Цветные линии скелета на картинке | В промпт добавить `Image 2 is only a pose guide.` |
| Лишняя одежда или каблуки | Чинить образ: обувь и все слои должны быть чётко видны |
| Лицо не похоже | Портрет в ракурсе позы. С листа лицо не вырезать |
| Персонаж стоит как на образе и игнорирует позу | Скелет в этом графе на s07 держался. Другую позу давать новой пластиной, не абзацем про одежду |
