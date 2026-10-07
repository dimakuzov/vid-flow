# Model: Qwen Image 2.1 Edit (персонаж)

Оригинал на русском. Для модели: `playbooks/models/qwen_image.en.md`.

Промпты для shot-персонажа: правка одежды. Правила этапа — `playbooks/stages/characters.md`. Граф и запуск — `playbooks/workflows/characters_comfy.md`.

Промпты локации — в `playbooks/models/qwen_location.md`. Промпт первого кадра — в `playbooks/models/qwen_first_frame.md`.

## Параметры

Как в графе `character_outfit_qwen21.json`, не менять:

| Параметр | Значение |
| --- | --- |
| Модель | `qwen_image_2.1_int8_convrot.safetensors` + LoRA `qwen2.1\lenovo_qwen21.safetensors`, сила 0.6 |
| Steps | 25 |
| CFG | 1.0 |
| Sampler / scheduler | euler / simple |
| Seed | случайный, 2–4 прогона, берётся лучший |
| Resolution энкодера | 1024, холст как у image 1 |

При cfg 1.0 negative на результат не влияет. Лишняя одежда и каблуки убираются чистыми входами, не списком запретов.

## Структура промпта

1. Роли картинок: `Image 1 is the standing girl. Image 2 is the green dress to copy.`
2. Что меняется в `<image1>` и как это выглядит: цвет, узор, крой, длина, слой под ним.
3. Что остаётся: обувь, лицо, волосы, поза, кадрирование, свет, фон — `exactly as in <image1>`.

Называть только меняемый слой. Отрицаний в позитивном промпте нет: писать то, что должно быть. Для мужского персонажа `girl` меняется на `man`. Без образца одежды строка про image 2 убирается, а одежда описывается полностью.

## Шаблоны

Правка одежды по образцу (teaser s07, Катя, принято):

```text
Image 1 is the standing girl. Image 2 is the green dress to copy. Change the outer green garment in <image1> so it matches the dress in <image2>: dark green, small gold teardrop motifs, a halter neckline, a fitted bodice, a tie at the waist, and a tiered skirt below the knees. The yellow turtleneck underneath is fitted and matte, with long sleeves and the collar visible. A large pearl necklace sits on the neck over the turtleneck collar, and each bead is big and white. The same grey shoes stay fully visible. Her face, pinned-up hair, standing pose, framing, lighting and plain light background stay exactly as in <image1>.
```

Замена низа вторым проходом (image 1 — результат первого прохода):

```text
Change the lower garment in <image1>. The green sarafan continues as one skirt from the shoulder straps down below the knees, over the yellow turtleneck. The same grey shoes stay fully visible. The necklace stays on the neck. Her face, pinned-up hair, standing pose, framing, lighting and plain light background stay exactly as in <image1>.
```

Продление обрезанного кадра вниз. Холст выше исходника, та же фигура:

```text
Extend <image1> downward into a full-length standing view. The head stays near the top of the frame. Both feet and plain flat shoes are fully visible at the bottom, with a margin of the plain light background under the shoes. Her face, hair, and standing pose stay as in <image1>. Plain light background.
```

## Do

- Один персонаж на проход. Роли картинок в первой фразе.
- Детали образца, которые нельзя потерять, назвать текстом: вырез, пояс, длина, слой под платьем, украшения.
- Всё невидимое на референсе либо показать, либо назвать прямо.
- Чинить противоречивые входы, а не дописывать запреты.

## Don't

- Не писать «не делай X» в позитивном промпте: модель часто делает X.
- Не описывать заново то, что должно остаться: только «stays exactly as in <image1>».
- Не смешивать два фото одного человека в разных позах.
