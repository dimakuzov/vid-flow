# Model: Qwen Image Edit

Оригинал на русском. Для модели: `playbooks/models/qwen_image.en.md`.

Промпты для shot-персонажа и первого кадра. Сборка позы под кадр описана в `playbooks/stages/characters.md`. Граф: `playbooks/workflows/characters_comfy.md`.

Промпты локации — в `playbooks/models/qwen_location.md`.

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

Загрузчики в графе — заглушки под Qwen 2.1: UNET, CLIP (`type: qwen_image`), VAE `qwen_image_vae`, Lightning LoRA под свою модель. Имена файлов в JSON не считать каноном.

## Структура промпта

1. Роли картинок.
2. Поза и движение, коротко, как подсказка к скелету.
3. Кадрирование и свет.

Внешность и одежду текстом не описывать: их задают картинки. Отрицаний в позитивном промпте нет. Писать только то, что должно быть.

Для мужского персонажа `woman` меняется на `man`. Если лицо не нужно (спиной), фраза про image 3 убирается вместе со связью image3 в обоих энкодерах.

## Шаблоны

Тексты собраны по проверенным правилам, но сами ещё гипотеза.

Поза по скелету (шаг сборки):

```text
Image 1 is the woman with her complete outfit. Image 2 is a pose skeleton. Image 3 is her face.

The woman from image 1, wearing exactly the outfit from image 1 with every garment, the shoes and the bag, takes the exact pose of the skeleton in image 2: [короткая поза, например: running fast to the right, side profile, mid-stride]. Her face is the face from image 3.

[Full body / Waist-up / From behind]. Plain light grey studio background, soft even light. Photorealistic.
```

Если на результате виден сам скелет, добавить: `Image 2 is only a pose guide.`

Правка образа, снять верхний слой (пример: куртка поверх платья). Позу на этом шаге не менять. Скрытую часть описать явно:

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
