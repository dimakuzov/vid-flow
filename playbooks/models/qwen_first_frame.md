# Model: Qwen first frame

Оригинал на русском. Для модели: `playbooks/models/qwen_first_frame.en.md`.

Промпт вписывания персонажа в локацию, Qwen Image 2.1 Edit. Куда класть файлы: `playbooks/stages/first_frame.md`. Граф: `playbooks/workflows/first_frame_comfy.md`.

Правила проверены на прошлом проекте: 12 кадров, около 110 генераций. С первого раза выходили один персонаж, простая поза и очевидное место. Дольше всего собирались двое, мелкая деталь (кровь, руки, отражение) и поверхность под ногами.

Второй проект (эпизод ep2, около 75 прогонов) добавил раздел «План кадра». Большинство долгих прогонов — средние и крупные планы, написанные по правилам общего плана: фигура выходила в полный рост, или модель перерисовывала комнату, чтобы сделать человека крупнее.

## Порядок блоков

Каждый блок — одно-два предложения. Сначала что и куда вставить, в конце что сохранить. Промпт короче ~200 слов. Больше ~250 слов и 8 требований модель выполняет частично.

```text
Place the girl from image 2 into the <place, one word> from image 1.
<where, described by what is visible on image 1>
<size in the frame: by the shot size, see «Shot size»>
<one action, body direction, where they look>
<only a story detail, or a detail that already broke>
Amateur snapshot, no special lighting on her: same dim <colour> light, same colour cast, face in shadow.
<lock: by the shot size, see «Lock»>
```

Для мужчины `girl` меняется на `man`.

### Номера картинок

В задаче есть список «Images the graph receives» — какие картинки получит граф. Номера брать ровно оттуда. image 1 — локация. Дальше персонажи по алфавиту имён, а не в порядке shot.md: у Лены и Юли Юля — image 2, Лена — image 3.

Если людей двое, у каждого в первом предложении имя и номер, дальше — по именам: `Place Julia (image 2) and Lena (image 3) into the lecture hall from image 1.` В ep2 промпты писали `Lena from image 2`, а image 2 была Юля, и девять прогонов девушки менялись ролями.

Внешность по памяти не описывать: волосы, очки, одежда берутся с референса. Неверное описание (`Lena in her sweater`, хотя свитер у Юли) тянет модель не к тому человеку.

Имена файлов и пути (`refs/portret.png`, `shots/s10/...`) в промпт не писать. Модель видит только картинки по номерам. Промпт с именем файла доска не запустит.

### Что и куда

Коротко: `Place the girl from image 2 into the street from image 1`.

Одежду не описывать. Она берётся с референса. Описывать одежду только когда её надо изменить относительно референса: без брюк, рукава закатаны, куртка расстёгнута.

### Где именно

Модель плохо понимает «тротуар» и «край кровати» на конкретной картинке.

`She runs on the sidewalk` несколько раундов подряд оставляло её на газоне. Сработало: `She runs on the grey paved strip at the very bottom of the frame, right next to the curb of the road, in front of the grass`.

Место описывать так, как оно выглядит на image 1: цвет, соседние предметы, часть кадра.

### План кадра

План берётся из первых слов текста кадра (`Close up`, `Medium shot`, `Long shot`). Сообщение пользователя важнее shot.md: «ещё ближе», «очень крупный план» — это крупный план. У каждого плана свой блок размера и свой замок. Не смешивать.

**Общий план.** Человек небольшой в комнате. Рост привязать к предмету: `the top of her head is at the height of the window sill`. `her head at three quarters of the wardrobe's height`. `the SAME HEIGHT as the girl, the top of his head at the same level as hers`. `small`, `correct human scale`, `do not make her big` не работали. `about one quarter of the frame height` помогает частично. Ближний план делает фигуру крупнее — уравновесить долей кадра. Доли кадра — только здесь.

**Средний план.** Размер — через то, где край кадра режет тело, а не долей: `she is close to the camera, visible from the waist up, the bottom edge of the frame cuts her at the waist, her head in the upper third of the frame`. За партой: `the desk edge crosses her at the waist`. Не писать `stands in the middle of the floor`, `one third of the frame height` и всё, где видны ноги: с референсом в полный рост одно слово `stands` даёт фигуру с сапогами.

**Крупный план.** Первое предложение — кадрирование: `Close-up portrait: her face and shoulders fill most of the frame, her eyes in the upper third.` Затем взгляд и выражение. Ни слова про пол, ноги и всю фигуру. В ep2 крупный план вышел, только когда промпт начался так и пропала строка `the same camera position, the same framing`.

Промпт среднего или крупного плана не двигает камеру по комнате. Человек подходит к камере, нижний край кадра его режет, комната сзади остаётся как есть (см. «Замок»). Если кадру нужен другой вид комнаты — это работа этапа локации, а не этого промпта.

### Лицо для крупного плана

В списке «Images the graph receives» могут быть лица: портреты персонажей, после самих персонажей. Доска отправит их, только если в промпте есть фраза `face from image N`. Решает агент:

- **Крупный план человека** (или пользователь просит очень крупно лицо): одна строка с номером лица этого человека из списка: `Her face exactly as the face from image 3: the same eyes, nose, lips and skin.` Если людей двое — только для того, кто крупно: `Julia's face exactly as the face from image 4.`
- **Средний и общий план**: фразу не писать. Там хватает одного референса на человека, а лишняя картинка — лишнее время.

Лица идут после персонажей, поэтому номера локации и персонажей не меняются, с лицом или без.

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

Последняя строка зависит от плана.

Общий план:

```text
Keep the location from image 1 exactly as it is: the same camera position and angle, the same framing, the same objects in the same places. Do not add any other people.
```

Средний план. Комнату нельзя перерисовывать, чтобы освободить место людям. Назвать предметы, которые важны пользователю (в ep2 — окно, которое всё время сдвигалось):

```text
The room behind them stays exactly as in image 1: the same window in the same place and size, the same walls. They are in front of it, close to the camera. Do not add any other people.
```

Крупный план. Не просить тот же кадр: тогда модель держит общий вид и оставляет человека мелким.

```text
Behind her is the room from image 1, the same walls and objects, seen closer and slightly out of focus. Do not add any other people.
```

Окружение не описывать. Исключение — предметы, которые пропадают, и предметы-ориентиры для места и масштаба.

Указания камеры (`low angle`, `ground level`) игнорируются: ракурс задаёт image 1.

Если image 1 — только фрагмент (стена, несколько ступеней, фактура), для среднего и общего плана модель дорисует остальную комнату, и на каждом seed по-разному. Крупному плану фрагмента хватает: в ep2 крупный план на гладкой деревянной панели приняли с первого прогона. Для среднего и общего плана нужен вид локации, где видно всё место.

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
2. План взят из shot.md или сообщения пользователя. Блок размера и замок ему соответствуют.
3. Номера картинок — из «Images the graph receives». У каждого человека имя и номер. Ни имён файлов, ни путей.
4. Крупный план: строка `face from image N` для того, кто крупно. Средний и общий: без неё.
5. Место описано через видимое на image 1.
6. Общий план: рост привязан к предмету. Средний: где край кадра режет тело. Крупный: лицо заполняет кадр.
7. Одно действие, направление тела и взгляд.
8. Референс не противоречит кадру. Если противоречит — `unlike image 2` или другой файл.
9. Детали только сюжетные или уже ломавшиеся.
10. Свет: любительский снимок и названный цвет, либо картинка-образец.
11. Короче ~200 слов.
12. Сразу 2–5 seed. Для двоих и для направления — 5–10.

## Пример, который приняли

Не сработало: длинная одежда, `wet pavement`, `one third of the frame height`, `Cinematic film still`. Фигура была крупной, студийной и стояла на газоне.

Принятый промпт:

```text
Place the girl from image 2 into the street from image 1. She runs on the grey paved strip at the very bottom of the frame, right next to the curb of the road, in front of the grass; both boots on this strip. She is at the very left edge of the frame, just entering from the left, running from left to right, mid-stride, one hand on the bag strap, head turned up to the right, lost and panicked. She is fairly small: about one quarter of the frame height, in proportion to the birch tree and the parked car. Amateur snapshot, no special lighting on her: a dark figure in the dim blue dusk, face in shadow, dark reflection on the wet paving. Keep the location from image 1 exactly as it is. Do not add any other people.
```

## Принято в ep2: крупный и средний план

Крупный план (s03, принят на 13-м прогоне; прогоны 1–5 давали фигуру в полный рост, потому что в промпте было `She stands in the middle of the floor` и `the same framing`):

```text
Place the girl from image 2 into the lecture hall from image 1. Her face fills most of the frame, an extreme close-up. She is turned to the left in profile, her face dominating the entire composition. She looks to the left, NOT at the camera. Her expression is calm and composed. She gazes thoughtfully around the room.
Amateur snapshot, no special lighting on her: the same cool, even institutional light as the lecture hall.
Keep the location from image 1 exactly as it is. Do not add any other people.
```

Сейчас этот промпт получил бы ещё замок крупного плана и, если лицо уплывает, строку `Her face exactly as the face from image 3`.

Средний план (s06, принят). Сработал, потому что локация уже снята с расстояния кафедры, а предмет (кафедра) режет тело:

```text
Place the professor from image 2 into the lecture hall from image 1. He stands behind the podium, his torso visible above the edge, shoulders and head clearly his own. The top of his head reaches about three quarters of the way up the tiered seating behind him. Both arms raised up at shoulder height, palms open, his mouth open, expression stern and commanding. He looks straight ahead and slightly down, angry, NOT at the camera. His body leans forward over the podium. Amateur snapshot, no special lighting on him: the same harsh overhead fluorescent light, sharp shadows across his face and neck, a hard edge where the podium cuts across his body. Keep the location from image 1 exactly as it is: the same camera position and angle, the same framing, the same objects in the same places. Do not add any other people.
```
