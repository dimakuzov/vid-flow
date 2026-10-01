# Model: Qwen Image Edit

Оригинал на русском. Для модели: `playbooks/models/qwen_image.en.md`.

Промпты для shot-персонажа. Сборка позы под кадр описана в `playbooks/stages/characters.md`. Граф: `playbooks/workflows/characters_comfy.md`.

Промпты локации — в `playbooks/models/qwen_location.md`. Промпт первого кадра — в `playbooks/models/qwen_first_frame.md`.

## Параметры

Lightning 4-step LoRA включена, сила 1.0.

| Параметр | Значение |
| --- | --- |
| Steps | 4 |
| CFG | 1.0 |
| Sampler / scheduler | euler / simple |
| Seed | случайный, 2–4 прогона, берётся лучший |
| Shift (AuraFlow) | 3.1, как в графе |
| CFGNorm | 1.0 |

При cfg 1.0 negative на результат не влияет. Лишняя одежда и каблуки убираются чистыми входами, не списком запретов. Negative-нода в графе оставлена на случай cfg выше 1; с Lightning это обычно портит картинку.

Эти параметры относятся к сборке позы. Правка одежды — другой проход: 25 шагов, cfg 1, euler / simple, LoRA `qwen2.1\lenovo_qwen21.safetensors` с силой 0.6. Имена файлов и обязательное поле `resolution_steps` — в разделе «Команда» `playbooks/workflows/characters_comfy.md`. Имена в JSON сборки не канон: UNET bf16 из файла на диске нет.

## Структура промпта

1. Роли картинок.
2. Поза и движение, коротко, как подсказка к скелету.
3. Кадрирование и свет.

В промпте сборки внешность и одежду текстом не описывать: их задают картинки. В промпте правки одежды называется только меняемый слой. Отрицаний в позитивном промпте нет. Писать только то, что должно быть.

Для мужского персонажа `woman` меняется на `man`. Если лицо не нужно (спиной), фраза про image 3 убирается вместе со связью image3 в обоих энкодерах.

## Шаблоны

Текст сборки закреплён на teaser s07. Одежду в нём не называть. Фраза «wearing exactly the outfit» на прогоне не использовалась: она снова описывает одежду текстом.

Поза по скелету (шаг сборки):

```text
Image 1 is the woman with her complete outfit. Image 2 is a pose skeleton. Image 3 is her face.

The woman from image 1 takes the exact pose of the skeleton in image 2: standing straight, arms at her sides. Her face is the face from image 3.

Full body. Plain light grey studio background, soft even light. Photorealistic.
```

Правка одежды называет только меняемый слой и держит остальное. В тексте есть `<image1>`. Позу не менять:

```text
Change the lower garment in <image1>. The green sarafan continues as one skirt from the shoulder straps down below the knees, over the yellow turtleneck. The same grey shoes stay fully visible. The necklace stays on the neck. Her face, pinned-up hair, standing pose, framing, lighting and plain light background stay exactly as in <image1>.
```

Продление обрезанного кадра вниз. Холст выше исходника, та же фигура:

```text
Extend <image1> downward into a full-length standing view. The head stays near the top of the frame. Both feet and plain flat shoes are fully visible at the bottom, with a margin of the plain light background under the shoes. Her face, hair, and standing pose stay as in <image1>. Plain light background.
```

Если на результате виден сам скелет, добавить: `Image 2 is only a pose guide.`

Снять верхний слой одной фразой на шоте не проверялось. Ниже старый пример, его не подставлять вместо правки из раздела «Команда»:

```text
The woman in image 1 now wears only the brown dress: the skirt part stays exactly the same, and the upper part continues in the same brown fabric — a simple fitted bodice, long sleeves, a round neckline. One continuous dress from shoulders to below the knees.

Her face, hair, pose, tights, boots, framing, lighting and plain white background stay exactly as in image 1.
```

Negative, только если нода его принимает и cfg выше 1. Слова без «no»:

```text
cape, cloak, second jacket, extra layers, high heels, stilettos
```

## Do

- Один образ на проход. Роли референсов в первой фразе.
- Всё невидимое на референсе либо показать, либо назвать прямо.
- Кроп лица, когда фигура мелкая.
- Чинить противоречивые входы, а не дописывать запреты.

## Don't

- Не описывать одежду и обувь текстом, если они должны прийти с картинки.
- Не переносить в промпт детали одежды с картинки-образца позы.
- Не писать «не делай X» в позитивном промпте: модель часто делает X.
- Не смешивать два фото одного человека в разных позах.
