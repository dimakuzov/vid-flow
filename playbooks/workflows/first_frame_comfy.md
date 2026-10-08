# Workflow: first_frame (Comfy)

Оригинал на русском. Для модели: `playbooks/workflows/first_frame_comfy.en.md`.

Граф: `playbooks/workflows/comfy/qwen21_character_compositing.json`. Это Qwen Image 2.1 Edit в формате API ComfyUI.

Промпт пишется по `playbooks/models/qwen_first_frame.md`. Frameboard граф не запускает.

Промпт внутри JSON — болванка с плейсхолдерами. Перед запуском его заменяют текстом этого кадра.

## Модели

| Узел | Файл |
| --- | --- |
| Load Diffusion Model | `qwen_image_2.1_int8_convrot.safetensors` |
| Load CLIP | `qwen3vl_8b_int8_convrot.safetensors`, type `qwen_image` |
| Load VAE | `qwen_image_2.1_vae_bf16.safetensors` |
| Load LoRA | `qwen2.1\lenovo_qwen21.safetensors`, strength 0.6 |

Нужны узлы `ResolutionSelector`, `SaveImageAdvanced`, `ComfySwitchNode`, `QwenImage21Cache`, `TextEncodeQwenImage21`. Они уже стояли в рабочем ComfyUI.

## Входы

Картинки кладутся в `ComfyUI/input`, имена вписываются в Load Image.

| Узел | Что подавать |
| --- | --- |
| Image 1 (location), id 470 | Утверждённая локация шота, `shots/{shotId}/location/approve/`. Для правки — уже выбранный первый кадр |
| Image 2 (character 1), id 902 | `shots/{shotId}/characters/approve/{name}_{shotId}.png` |
| Image 3 (character 2), id 903 | Второй персонаж. Если персонаж один, узел удалить и убрать `images.image_3` из узла 488 |
| Face of character 1, id 904 | Только для крупного плана: портрет первого персонажа. Иначе узел удалить и убрать `images.image_4` из узла 488 |
| Face of character 2, id 905 | Только для крупного плана второго персонажа. Иначе узел удалить и убрать `images.image_5` из узла 488 |

В промпте подключённые картинки называются `image 1`, `image 2`, … в порядке входов. Text Encode Qwen Image 2.1 пропускает удалённый вход и нумерует остальные подряд: при одном персонаже и лице лицо — image 3.

Доска удаляет лишнее сама (манифест `first_frame_compositing.bind.json`): лица уходят, только если в `prompt.md` есть `face from image N`.

Поза и направление на референсе должны быть близки к кадру: модель берёт направление бега с картинки. Если референс противоречит кадру, его меняют или пишут `unlike image 2`.

## Что менять

| Узел | Поле | Что ставить |
| --- | --- | --- |
| Positive Prompt (477) | `value` | Промпт этого кадра |
| KSampler (485) | `seed` | Новый случайный seed на каждый вариант |
| Save Image (Advanced) (461) | `filename_prefix` | Уже `frameboard/first_frame/ff_v1`. Для следующего варианта поменять суффикс |
| Resolution Selector (13) | `aspect_ratio` | Оставить `9:16 (Portrait Widescreen)`, 2.3 MP |

Не трогать: 25 шагов, cfg 1, euler / simple, LoRA 0.6, resolution 1024 в текстовом энкодере, `switch = true`. Кадр собирается в пустом латенте нужного размера, не поверх латента image 1.

## Как открыть

Файл в API-формате может открыться без раскладки узлов. Тогда взять рабочий граф Qwen Image 2.1 edit, добавить два Load Image и подключить их к Text Encode Qwen Image 2.1 во входы `image_2` и `image_3`.

Через API тот же JSON уходит в `POST http://127.0.0.1:8188/prompt` как `{"prompt": <содержимое файла>}`. Перед отправкой меняются prompt, seed и prefix. Frameboard этот запрос не делает.

## Порядок

1. Сборка. Image 1 — чистая локация. 2–5 seed. Для двоих и для направления — 5–10.
2. Если не так место, размер, поза или направление — править промпт и собирать заново.
3. Мелкая правка: image 1 — выбранный кадр, промпт `Edit image 1: <одно изменение>. Keep EVERYTHING else exactly the same`. Вторым входом можно дать референс персонажа или кадр с нужным светом.
4. Не больше одной-двух правок подряд.
5. Варианты скопировать в `shots/{shotId}/first_frame/output/` как `{shotId}_ff_v1.png` и дальше. Промпт раунда — в `prompt.md`. Выбранный файл — `approve/{shotId}_first.png`.

## Если что-то не так

| Проблема | Что делать |
| --- | --- |
| Персонаж светлее окружения | `amateur snapshot, no special lighting` и конкретный цвет. Либо правка по образцу |
| Не та поверхность | Описать место цветом, соседними предметами и частью кадра |
| Слишком крупный | Привязать рост к предмету локации |
| Средний план вышел в полный рост | Описать, где край кадра режет тело (`the bottom edge of the frame cuts her at the waist`), без доли кадра и без `stands on the floor` |
| Крупный план вышел общим | Начать с `Close-up portrait: her face fills most of the frame`, замок крупного плана без `the same framing` |
| Комнату перерисовало (сдвинулось окно) | Замок среднего плана с предметами, которые должны остаться; или вид локации с расстояния кадра на этапе локации |
| Лицо уплывает на крупном плане | Добавить `Her face exactly as the face from image N` |
| Двое поменялись местами или ролями | Имя и номер обоих в первом предложении, номера из «Images the graph receives» |
| Пропадают предметы локации | Перечислить их поимённо, `same places, sharp` |
| Фон мутный | Собрать заново из чистой локации |
| Смотрит в камеру | Написать, куда смотрит, и `NOT at the camera` |
