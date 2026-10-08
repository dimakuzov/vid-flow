# Model: Krea 2 location

Оригинал на русском. Для модели: `playbooks/models/krea2_location.en.md`.

Новая локация по тексту. Граф `playbooks/workflows/comfy/location_krea2_api.json`, манифест `location_krea2` (этап `location`, пункт меню «Локация с нуля: Krea 2 по тексту»). Когда выбирать его, а когда `location_views`: `playbooks/stages/location.md`, раздел «Какой граф».

## Что за модель

Krea 2 Turbo — 12B DiT, текстовый энкодер Qwen3-VL 4B, VAE Qwen Image. Turbo дистиллирована на 8 шагов и работает без CFG [1][2][3]. Обучена в основном на длинных подробных описаниях [4].

В графе:

| Нода | Что | Кто меняет |
| --- | --- | --- |
| `61` | текст промпта | доска: весь `prompt.md` |
| `67` → `66.image1` | картинка-референс | доска: первый файл `refs/`, иначе общий вид из `data/locations/`; нет ни того, ни другого — нода убирается, чистый text-to-image |
| `49` | 2 Мп, соотношение | доска ставит `9:16 (Portrait Widescreen)` |
| `54` | 8 шагов, cfg 1, euler / simple | доска ставит случайный seed |
| `60`, `65`, `63` | LoRA `krea2_darkbrush` 0.5 и `V67_Interior_design` 0.5, переключатель | только пользователь в ComfyUI |
| `29` | сохранение | префикс `frameboard/location/{shotId}_krea2` |

Негатива нет: `ConditioningZeroOut` и cfg 1. Всё, что нужно, пишется в позитивный промпт.

### Картинка — смысл, а не пиксели

Картинка идёт в Qwen3-VL вместе с текстом. Krea 2 берёт из неё смысл и стиль и рисует заново, а не правит её [5]. Комната с референса не сохранится: другая планировка, другие окна. Нужна та же комната с другого ракурса — граф `location_views`. Референс здесь — для настроения, предмета или материала (в графе пользователя это был стол).

Граф берёт одну картинку — первый файл в `refs/`. Второй референс (в ep2 — фото гранёного стакана рядом с фото столовой) не уходит. Такой предмет описать словами: `a faceted Soviet glass of strong tea in a metal holder`.

### План кадра

Утверждённая локация становится фоном первого кадра как есть. Камеру писать под план из первых слов текста кадра; сообщение пользователя важнее. Общий: `wide composition, eye level`, всё пространство. Средний: `eye level, about two metres from <место>`, то, что за людьми, такого размера, каким оно будет за человеком по пояс, нижняя часть кадра свободна. Крупный: `close view of <часть стены, окна>`, хватает фрагмента. Место для людей называть: `the empty chair in the center of the frame`.

## Шаблон `prompt.md`

Один связный абзац на английском, без списков и разметки [6]. Без заголовков `## …`: у графа одна ветка.

```text
(Interior design:1.1), IntemporalDesign, structural framing, surface treatment, furnishings arrangement, lighting strategy, color palette, ornamental language, spatial rhythm, material juxtaposition, era-informed styling

<Тип и масштаб пространства, эпоха и место>. <Стены, потолок, пол, окна, двери: цвета и материалы>. <Главный предмет и его детали>. <Остальные предметы, каждый со своими цветом и материалом>. <Свет: источники, время суток, цветовая температура>. <Мелкие неидеальные детали>. Empty room, no people. Photorealistic, <объектив>, <высота камеры и крупность>, <плёнка/цвет>.
```

Первая строка — слова-триггеры LoRA `V67_Interior_design` из графа пользователя. Оставлять как есть. Для улицы и двора (не интерьер) её можно убрать или выключить LoRA в ComfyUI (нода `63`).

## Что работает

- **Длинно и конкретно.** Короткий промпт Krea 2 дорисовывает сама, и каждый прогон выходит в другую сторону. Чем больше деталей (материал, цвет, свет, композиция), тем уже разброс [4][7]. Для локации серии нужен узкий разброс: 80–200 слов.
- **Конкретные цвета и материалы:** `light blue-gray walls`, `solid walnut`, `worn linoleum with a brown parquet pattern`, а не `nice walls`, `wooden table` [6][8].
- **Эпоха и место прямо по имени:** `a Soviet 1970s Khrushchyovka kitchen`, `a Moscow university corridor in the 1980s`. Названная эпоха или медиум перестраивает весь кадр под себя [9].
- **Предмет вместе со своими признаками,** в одном предложении: `a long walnut table with turned legs and a dark knot running down the center` [6].
- **Неидеальные детали** против «вылизанного» вида: `chipped enamel on the sink`, `a faded calendar on the wall`, `scuffs on the door frame` [9].
- **Камера словами:** `35mm lens, wide composition, eye level`, `low angle from the doorway` [8].
- **Свет по источникам:** что светит, откуда и какого цвета. Krea 2 хорошо держит два света в одном кадре (дневное окно и тёплые свечи в примере ниже).
- **Надписи — в кавычках:** `a sign that reads "OPEN"` [6]. Кириллицу в `prompt.md` доска не пропускает (5+ русских букв в строке — ошибка запуска), поэтому надписи латиницей или без текста.
- Мелкая правка текста сильно меняет картинку. Сравнивая два промпта, смотреть несколько вариантов, а не один [10].

## Чего избегать

- Списков через запятую без предложений, JSON, markdown. Один абзац [6].
- Длинного перечня того, чего нет. Негатива нет, а `no pool, no lamp, no TV` может подсунуть эти предметы. Одна фраза `Empty room, no people.` в конце — допустимо.
- Описывать референс, чтобы «сохранить» комнату. Сохранять — не задача Krea 2, см. «Картинка — смысл».
- Новых весов `(word:1.3)`. В официальных материалах Krea 2 их нет. Строка-триггер с `(Interior design:1.1)` взята из рабочего графа пользователя и остаётся.
- Людей. Локация пустая; персонажей вписывает этап `first_frame`.
- Малой глубины резкости. Фон должен остаться резким для следующих этапов.

## Пример

Промпт из графа пользователя (столовая), шёл в работу:

```text
(Interior design:1.1), IntemporalDesign, structural framing, surface treatment, furnishings arrangement, lighting strategy, color palette, ornamental language, spatial rhythm, material juxtaposition, era-informed styling, modern furniture, antique furniture, v67_victorian

A spacious dining room inside a hillside house, high ceilings with subtle crown molding, light blue-gray walls, elegant refined interior, no view of the pool. A long rectangular dining table made entirely of solid walnut wood, one uniform material top to bottom, no inlay, no contrasting materials, dark wood base with turned legs. The wood grain flows lengthwise along the table, except for one continuous knotted streak running down the center from end to end, where the grain twists into a dark, tightly whorled knot pattern. Ten upholstered cream-colored curved-back dining chairs with dark wood legs surround the table. A chandelier fitted with candles hangs above the table. One end of the room lit by flat, cool daylight from a window, the other end glowing with warm flickering candlelight, the two light qualities meeting across the tabletop. A wooden console table against the wall beneath framed artwork, a large vase with greenery, flanked by brass wall sconces. Wide-plank wood floor, large patterned area rug, tall curtained doorway to the side. Photorealistic, 35mm lens, wide composition, cinematic lighting contrast
```

Черновик под сериал (не проверен прогоном):

```text
(Interior design:1.1), IntemporalDesign, structural framing, surface treatment, furnishings arrangement, lighting strategy, color palette, ornamental language, spatial rhythm, material juxtaposition, era-informed styling

A small kitchen in a Soviet five-story apartment block in the late 1970s, low ceiling, walls painted pale green up to shoulder height and whitewashed above. A narrow window with a white wooden frame and a gauze curtain looks onto bare autumn trees. Along the left wall stand a white enamel gas stove with four burners and a chipped edge, a small white refrigerator with rounded corners and a chrome handle, and a cast-iron sink with a single brass tap. A square table with a worn oilcloth in a faded red check pattern stands by the window with two wooden stools. A tin kettle on the stove, a jar of pickled cucumbers on the windowsill, a tear-off calendar on the wall. Brown linoleum floor with a parquet print, worn pale in front of the stove. Flat grey overcast daylight from the window, a bare bulb under a glass shade switched off. Empty room, no people. Photorealistic, 28mm lens, eye level from the doorway, wide composition, muted natural colors.
```

## Перед запуском

1. Пространство новое или нужен свежий вариант для библиотеки — Krea 2. Та же комната с другой точки — `location_views`.
2. Один абзац на английском после строки-триггера, 80–200 слов.
3. У каждого предмета цвет и материал. Эпоха названа.
4. Свет по источникам, камера словами.
5. В конце `Empty room, no people.` Людей и малой глубины резкости нет.
6. Картинка в `refs/` только если нужен смысловой референс; первый файл по имени — тот, что уйдёт.

## Источники

1. Krea, «Krea 2 Open-Source: RAW and Turbo». https://www.krea.ai/krea-2-open-source
2. krea-ai/krea-2, README: Turbo — 8 шагов, CFG 0. https://github.com/krea-ai/krea-2
3. ComfyUI Wiki, «Krea 2 Open Source». https://comfyui-wiki.com/en/news/2026-06-22-krea-2-open-source-text-to-image
4. Krea, «Krea 2 technical report» (длинные подписи в обучении, Qwen3-VL как энкодер текста и картинки). https://www.krea.ai/blog/krea-2-technical-report
5. RunComfy, «Krea 2 Turbo ComfyUI workflow» и обзор Krea 2 Reference (картинка идёт как смысл, модель перерисовывает). https://www.runcomfy.com/comfyui-workflows/krea-2-turbo-comfyui-workflow-fp8-diffusion-qwen-image-generation
6. krea-ai/krea-2, `docs/prompting.md` и `docs/expansion.txt` (естественный язык, один абзац, текст в кавычках). https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md
7. Krea, «Explorative prompting with Krea 2». https://www.krea.ai/blog/explorative-prompting-krea-2
8. fal.ai, «Krea 2 Prompting Guide + Examples». https://fal.ai/learn/tools/krea-2-prompting-guide
9. fal.ai, «How To Use Krea 2 Open Source». https://fal.ai/learn/tools/how-to-use-krea-2-open-source
10. «Krea 2: Run the New 12B Open-Weights Image Model» (фиксировать seed при сравнении промптов). https://www.qwe.edu.pl/tutorial/krea-2-12b-open-weights-image-model/
