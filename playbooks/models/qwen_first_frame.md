# Model: Qwen first frame

Оригинал на русском. Для модели: `playbooks/models/qwen_first_frame.en.md`.

Промпт вписывания персонажа в локацию, Qwen Image 2.1 Edit. Куда класть файлы: `playbooks/stages/first_frame.md`. Граф: `playbooks/workflows/first_frame_comfy.md`.

Правила проверены на прошлом проекте: 12 кадров, около 110 генераций. С первого раза выходили один персонаж, простая поза и очевидное место. Дольше всего собирались двое, мелкая деталь (кровь, руки, отражение) и поверхность под ногами.

## Порядок блоков

Каждый блок — одно-два предложения. Сначала что и куда вставить, в конце что сохранить. Промпт короче ~200 слов. Больше ~250 слов и 8 требований модель выполняет частично.

```text
Place the girl from image 2 into the <place, one word> from image 1.
<where, described by what is visible on image 1>
<scale tied to a specific object on image 1>
<one action, body direction, where they look>
<only a story detail, or a detail that already broke>
Amateur snapshot, no special lighting on her: same dim <colour> light, same colour cast, face in shadow.
Keep the location from image 1 exactly as it is. Do not add any other people.
```

Для двоих: `Place the girl from image 2 and the young man from image 3`. Для мужчины `girl` меняется на `man`.

### Что и куда

Коротко: `Place the girl from image 2 into the street from image 1`.

Одежду не описывать. Она берётся с референса. Описывать одежду только когда её надо изменить относительно референса: без брюк, рукава закатаны, куртка расстёгнута.

### Где именно

Модель плохо понимает «тротуар» и «край кровати» на конкретной картинке.

`She runs on the sidewalk` несколько раундов подряд оставляло её на газоне. Сработало: `She runs on the grey paved strip at the very bottom of the frame, right next to the curb of the road, in front of the grass`.

Место описывать так, как оно выглядит на image 1: цвет, соседние предметы, часть кадра.

### Масштаб

`small`, `correct human scale`, `do not make her big` не работали. `about one quarter of the frame height` помогает частично.

Работает привязка к предмету: `the top of her head is at the height of the window sill`. `her head at three quarters of the wardrobe's height`. `the SAME HEIGHT as the girl, the top of his head at the same level as hers`.

Ближний план делает фигуру крупнее. Это надо уравновесить долей кадра.

### Поза и взгляд

Одно главное действие. Направление движения модель берёт из позы на референсе. Если на картинке бег вправо, а нужен влево, около половины seed игнорирует текст. Тогда нужен референс с нужным направлением или 5–10 seed.

Взгляд писать явно: `looks down at her knee, NOT at the camera`. Иначе взгляд часто уходит в камеру.

Сложную геометрию описывать физически. Для зеркала сработало: `stands squarely facing the mirror, shoulders parallel to it, looks at her own eyes in the mirror, NOT into the lens`. `looks at herself` недостаточно.

Чужие руки пропали после: `elbows out to the sides, her own hands behind her head, the arms clearly belong to her shoulders`.

### Детали

Писать только сюжетное или то, что уже сломалось.

Пропадающие предметы локации перечислять поимённо: `striped glass cup with toothbrushes, tall yellow shampoo bottles, all sharp, in the same places`.

Точное место детали: `the blood stain is exactly where the tissue touches her nostril`.

Если референс противоречит нужному состоянию: `the braid is NOT finished, NO hair tie (unlike image 2)`, либо другой референс.

Мелкую деталь вроде крови надёжнее добавить вторым шагом, правкой готового кадра. При сборке с нуля она выходит слишком большой.

### Свет

`match the lighting` почти ничего не даёт: персонаж остаётся студийным и светлее комнаты.

Работает связка: `amateur snapshot, no special lighting on the person`, затем конкретный цвет каста. Примеры: `cold blue-grey cast like the white bed sheets and the walls`. `dim blue twilight, face in shadow, dark reflection on the wet paving`. При необходимости `slightly underexposed like everything around`.

Слово `warm` без образца дало ядрёный оранжевый. Свет по образцу лучше слов: второй картинкой дать кадр той же локации с нужным светом и написать `change ONLY the lighting and colour so they match image 2`.

### Замок

Этой строки достаточно:

```text
Keep the location from image 1 exactly as it is: the same camera position and angle, the same framing, the same objects in the same places. Do not add any other people.
```

Окружение не описывать. Исключение — предметы, которые пропадают, и предметы-ориентиры для места и масштаба.

Указания камеры (`low angle`, `ground level`) игнорируются: ракурс задаёт image 1. Они имеют смысл только для крупного плана с размытым фоном, и размытие модель почти не делает.

## Режимы

Сборка с нуля, когда меняется композиция. Правка готового кадра, когда изменение локальное:

```text
Edit image 1: <one change>. Keep EVERYTHING else exactly the same: <what must not move>.
```

`much less blood` может убрать кровь совсем. Писать целевое состояние: `a small red stain the size of a coin exactly at the nostril`.

Не больше одной-двух правок подряд. Дальше собирать заново из чистой локации.

## Что не писать

- Длинное описание одежды при готовом референсе.
- Описание всего окружения.
- Отрицание без позитивной замены: `not on the grass` слабее, чем описание серой полосы у бордюра.
- `IMPORTANT`, капс и повтор одного требования.
- `small`, `correct scale`, `realistic proportions` без предмета.
- Длинный стилевой хвост. Хватает одной короткой строки в конце, если она нужна.

## Перед запуском

1. Сборка или правка.
2. Место описано через видимое на image 1.
3. Рост привязан к предмету.
4. Одно действие, направление тела и взгляд.
5. Референс не противоречит кадру. Если противоречит — `unlike image 2` или другой файл.
6. Детали только сюжетные или уже ломавшиеся.
7. Свет: любительский снимок и названный цвет, либо картинка-образец.
8. Короче ~200 слов.
9. Сразу 2–5 seed. Для двоих и для направления — 5–10.

## Пример, который приняли

Не сработало: длинная одежда, `wet pavement`, `one third of the frame height`, `Cinematic film still`. Фигура была крупной, студийной и стояла на газоне.

Принятый промпт:

```text
Place the girl from image 2 into the street from image 1. She runs on the grey paved strip at the very bottom of the frame, right next to the curb of the road, in front of the grass; both boots on this strip. She is at the very left edge of the frame, just entering from the left, running from left to right, mid-stride, one hand on the bag strap, head turned up to the right, lost and panicked. She is fairly small: about one quarter of the frame height, in proportion to the birch tree and the parked car. Amateur snapshot, no special lighting on her: a dark figure in the dim blue dusk, face in shadow, dark reflection on the wet paving. Keep the location from image 1 exactly as it is. Do not add any other people.
```
