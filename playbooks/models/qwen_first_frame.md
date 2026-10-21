# Model: Qwen first frame

Оригинал на русском. Для модели: `playbooks/models/qwen_first_frame.en.md`.

Промпт вписывания персонажа в локацию, Qwen Image 2.1 Edit. Куда класть файлы: `playbooks/stages/first_frame.md`. Граф: `playbooks/workflows/first_frame_comfy.md`.

Правила проверены на прошлом проекте: 12 кадров, около 110 генераций. С первого раза выходили один персонаж, простая поза и очевидное место. Дольше всего собирались двое, мелкая деталь (кровь, руки, отражение) и поверхность под ногами.

Второй проект (эпизод ep2, около 75 прогонов) добавил раздел «План кадра». Большинство долгих прогонов — средние и крупные планы, написанные по правилам общего плана: фигура выходила в полный рост, или модель перерисовывала комнату, чтобы сделать человека крупнее.

Третий эпизод (episode3, 15 кадров, около 70 прогонов) добавил раздел «Главное: референсы важнее текста». Больше всего повторов дали две вещи. Модель меняла локацию: двигала и добавляла предметы, меняла здания и свет («не меняй локацию, ничего не двигай и не добавляй», «свет тоже не меняй»). И в промпте была одежда не с референса: Иван в «тёмном мокром пальто» из shot.md вместо белой куртки с референса, сумка «большая, чтобы влезли книги» вместо сумки-мешка — сумку пришлось исправлять в четырёх кадрах.

## Главное: референсы важнее текста

Цель этого этапа — только добавить персонажей в локацию. Больше ничего не меняется.

- **Локация — image 1 как есть.** Тот же ракурс, та же точка съёмки, то же кадрирование, те же предметы на тех же местах, тот же свет и цвет. Ничего не добавлять, не убирать, не двигать, не перерисовывать. Это для любого плана: общего, среднего и крупного.
- **Персонаж — как на своём референсе.** Та же одежда, обувь, сумка, головной убор, причёска и прочие вещи. Одежду, сумку и вещи в промпте не описывать вовсе: только строка «как на image N» (см. «Одежда и вещи»).
- **Текст кадра (shot.md) не спорит с референсами.** Если в shot.md написано «тёмное пальто», а на референсе белая куртка — верен референс. Если в shot.md дождь, туман, фонарь или другой свет, которых нет на image 1, — их нет и в промпте: погода и свет — это локация, её этот этап не меняет.
- **Исключение — только явная просьба пользователя** в сообщении агенту: «переодень её в пальто», «добавь ей сумку», «сделай темнее». Тогда в промпте одна строка про это изменение, остальное по правилам выше.

## Порядок блоков

Каждый блок — одно-два предложения. Сначала что и куда вставить, в конце что сохранить. Промпт короче ~200 слов. Больше ~250 слов и 8 требований модель выполняет частично.

```text
character1 is image 2.                      (with a portrait: character1 is image 2 and the face from image 3.)
<Shot size>. Add character1 <on the exact spot, described by what is visible on image 1>.
<size in the frame: by the shot size, see «Shot size»>
<one action, body direction, where they look>
<only a story detail, or a detail that already broke>
character1's clothes, shoes, bag and everything they wear or carry exactly as in image 2.
character1 is lit by the same light as everything in image 1.
<lock, see «Lock»>
```

Если людей двое: первые строки привязывают character1 и character2, затем одно предложение добавляет обоих на их место.

Каждая мысль — один раз: люди добавляются один раз (предложение «Add»), image 1 сохраняется один раз (замок), каждый референс привязан один раз. Замок не повторяет, что люди добавлены.

### Номера картинок

В задаче есть список «Images the graph receives» — какие картинки получит граф и что на каждой. Номера брать ровно оттуда. image 1 — локация. Дальше персонажи по алфавиту имени файла, а не в порядке shot.md: у Лены и Юли Юля — image 2, Лена — image 3. В промпте это character1 и character2 в том же порядке, не Юля и не Лена. Дальше портреты с теми же номерами: лицо character1 — image 4, лицо character2 — image 5. Всего до 6 картинок; что не влезло, задача называет отдельно, на это не ссылаться.

Все картинки из списка уходят в модель, поэтому в промпте названа каждая: кто на ней и зачем она. Картинка без слов в промпте сбивает модель: она не знает, куда её деть, и может вписать портрет вторым человеком.

Если людей двое, в первых предложениях привязать каждого к картинкам и дать одно-два предложения, чтобы модель их различала: `character1 is image 2 and the face from image 4. character2 is image 3 and the face from image 5. Medium shot. Add character1 and character2, both at the second desk from image 1, …` В ep2 промпты писали `Lena from image 2`, а image 2 была Юля, и девять прогонов девушки менялись ролями. Имя из задачи делает то же: модель не знает, к какой картинке оно относится.

Внешность по памяти не описывать: волосы, очки, одежда берутся с референса. Неверное описание тянет модель не к тому человеку. Имя из задачи в промпт не писать.

Имена файлов и пути (`refs/portret.png`, `shots/s10/...`) в промпт не писать. Модель видит только картинки по номерам. Промпт с именем файла доска не запустит.

### Добавить и поставить одним предложением

Одно предложение добавляет людей и ставит их на место: `Add character1 and character2, both sit on the wooden bench from image 1, on the right of the frame`. Перед ним не писать отдельное `Place … into the park from image 1`: это два места для одних и тех же людей (дорожка, потом лавка) и два указания их добавить.

### Писать, что нужно, а не чего не делать

Модель читает каждое слово как часть картинки. Отрицание вносит нежелательное в промпт: `NOT at the camera` добавляет слово «камера», `do not add other people` — людей. Прежде чем писать `not`, `no`, `never`, `do not`, `NOT`:

1. Найти, что в промпте или в референсах может вызвать нежелательный результат: нет цели, слово-подсказка, поза на референсе.
2. Исправить эту причину и написать нужное состояние как факт.

| Вместо | Писать |
| --- | --- |
| `looks to the left, NOT at the camera` | `looks past the left edge of the frame, towards the window` (у взгляда есть цель) |
| `NOT standing` | `sits on the bench, back against the backrest, knees bent` |
| `not on the grass` | `on the grey paved strip right next to the curb` |
| `Do not add any other people` | `The only people in the frame are character1 and character2.` |
| `nothing moved` | `every object in the same place and size` |
| `the braid is NOT finished, NO hair tie` | `the braid is half done, the loose end hangs free, unlike image 2` |

Отрицание остаётся, только если прогон уже показал ошибку, а позитивная формулировка её не исправила; не больше одного на промпт. Если пользователь пишет «не …», это тоже переводится в нужное состояние.

### Без референсов персонажей

Если в «Images the graph receives» только image 1, в кадре нет персонажей. Не писать `image 2` и не выдумывать человека. image 1 остаётся как есть: то же место, камера, предметы и свет. Добавить только то, о чём просят действие кадра и сообщение пользователя, и ничего больше. Начало: `Edit image 1:`, дальше это добавление. Место заново не описывать.

### Одежда и вещи

Одежда, обувь, сумка, шапка, зонт и прочие вещи — с референса персонажа, без изменений. Их не описывать: ни цвет, ни фасон, ни размер, ни «закрыта», ни «на плече». Любое описание модель рисует по-своему: в episode3 фраза `a large black shoulder bag, big enough to hold several books` дала другую сумку, и пользователь четыре раза писал «сумка мешок».

Вместо описания — одна строка на каждого человека:

- Один: `character1's clothes, shoes, bag and everything she wears or carries exactly as in image 2.`
- Двое: `character1's clothes exactly as in image 2. character2's clothes and bag exactly as in image 3.`

Одежду из текста кадра (shot.md) не брать: если она расходится с референсом, верен референс.

Менять одежду или вещи — только по явной просьбе пользователя («без куртки», «рукава закатаны», «добавь сумку-мешок на плечо»). Тогда одна строка про это изменение, а остальное по-прежнему `exactly as in image 2`. Если просят вещь, которая на референсе уже есть, — не описывать её заново, а написать `her bag exactly as in image 2`.

### Где именно

Модель плохо понимает «тротуар» и «край кровати» на конкретной картинке.

`She runs on the sidewalk` несколько раундов подряд оставляло её на газоне. Сработало: `She runs on the grey paved strip at the very bottom of the frame, right next to the curb of the road, in front of the grass`.

Место описывать так, как оно выглядит на image 1: цвет, соседние предметы, часть кадра. Это описание — ориентир для человека, а не новое описание локации: не добавлять предметов, которых на image 1 нет.

Если описание локации показывает больше одного пространства, каждый человек стоит в том пространстве, которое задаёт действие кадра, на поверхности, где можно стоять. Расстояние между ними берут из размеров этих пространств в описании. Проём между пространствами оставляют закрытым, приоткрытым или открытым — как он виден на image 1 — и ставят людей по нужные стороны, если действие этого требует. Пространства и проёмы, которых на image 1 нет, не выдумывать.

### План кадра

План берётся из первых слов текста кадра (`Close up`, `Medium shot`, `Long shot`). Сообщение пользователя важнее shot.md: «ещё ближе», «очень крупный план» и `much closer` — это крупный план. Предложения про размер переписать блоком крупного плана ниже. С прошлым кадром не сравнивать: `much closer to the camera than before`, `closer than before`, `than before`, `as before` запрещены, доска такой промпт не запустит. Модель тот кадр не видела. Писать, насколько близко человек стоит сейчас. Если в prompt.md такое сравнение уже есть — удалить. У каждого плана свой блок размера. Замок один для всех (см. «Замок»).

Камера и локация не двигаются ни на каком плане. План получается только тем, насколько близко к камере стоит человек.

**Общий план.** Человек небольшой в комнате. Рост привязать к предмету: `the top of her head is at the height of the window sill`. `her head at three quarters of the wardrobe's height`. `the SAME HEIGHT as the girl, the top of his head at the same level as hers`. `small`, `correct human scale`, `do not make her big` не работали. `about one quarter of the frame height` помогает частично. Ближний план делает фигуру крупнее — уравновесить долей кадра. Доли кадра — только здесь.

**Средний план.** Размер — через то, где край кадра режет тело, а не долей: `she is close to the camera, visible from the waist up, the bottom edge of the frame cuts her at the waist, her head in the upper third of the frame`. За партой: `the desk edge crosses her at the waist`. Не писать `stands in the middle of the floor`, `one third of the frame height` и всё, где видны ноги: с референсом в полный рост одно слово `stands` даёт фигуру с сапогами.

**Крупный план.** Человек у самой камеры: `She stands right in front of the camera, very close: her face and shoulders fill most of the frame, her eyes in the upper third.` Затем взгляд и выражение. Ни слова про пол, ноги и всю фигуру. Локация за ней та же, что на image 1, ничего не перерисовывается.

Если локация снята слишком издалека и человек на нужном плане в неё не помещается — это работа этапа локации (другой вид места), а не этого промпта. Не просить модель «приблизить» или «показать ближе» комнату: в episode3 так она перерисовывала лестницу и стены.

### Портреты

В списке «Images the graph receives» после персонажей идут их портреты (`character1 face`). Доска отправляет их всегда, если портрет есть. Для каждого портрета в промпте одна строка: чьё это лицо, по номеру персонажа и номеру картинки.

- С одним человеком: `character1 is image 2 and the face from image 3: her face exactly as in image 3, the same eyes, nose, lips and skin.`
- С двумя: `character1's face exactly as in image 4, character2's face exactly as in image 5.`
- Портрет — только лицо. Одежда, поза и рост — с референса персонажа (image 2, image 3). Не писать `the girl from image 4`: модель добавит лишнего человека.

Портреты идут после персонажей, поэтому номера локации и персонажей не зависят от того, есть ли портрет.

### Поза и взгляд

Одно главное действие. Направление движения модель берёт из позы на референсе. Если на картинке бег вправо, а нужен влево, около половины seed игнорирует текст. Тогда нужен референс с нужным направлением или 5–10 seed.

Взгляд писать явно, с целью на image 1: `looks down at her knee`, `looks along the path at the far lamp post`. Без цели взгляд часто уходит в камеру; цель помогает лучше, чем `NOT at the camera`.

Сложную геометрию описывать физически. Для зеркала сработало: `stands squarely facing the mirror, shoulders parallel to it, looks at her own eyes in the mirror`. `looks at herself` недостаточно.

Чужие руки пропали после: `elbows out to the sides, her own hands behind her head, the arms clearly belong to her shoulders`.

### Детали

Писать только сюжетное или то, что уже сломалось.

Пропадающие предметы локации перечислять поимённо: `striped glass cup with toothbrushes, tall yellow shampoo bottles, all sharp, in the same places`.

Точное место детали: `the blood stain is exactly where the tissue touches her nostril`.

Если референс противоречит нужному состоянию: `the braid is half done, the loose end hangs free (unlike image 2)`, либо другой референс.

Мелкую деталь вроде крови надёжнее добавить вторым шагом, правкой готового кадра. При сборке с нуля она выходит слишком большой.

### Свет

Свет и цвет локации не меняются. Человек получает тот свет, который уже есть на image 1, а не свой.

Одна строка: `character1 is lit by the same light as everything in image 1.` При необходимости: `slightly underexposed like everything around`.

Не называть свой свет и цвет: ни `harsh yellow lamp`, ни `cold blue-grey cast`, ни `dim blue twilight`, если агент не уверен, что это именно то, что видно на image 1. Названный цвет модель красит на всю картинку: в episode3 пользователь писал «свет тоже не меняй». `match the lighting` почти ничего не даёт: персонаж остаётся студийным и светлее комнаты, поэтому нужна строка выше.

Погоду и эффекты (дождь, туман, лучи, отражения), которых нет на image 1, не добавлять: это меняет локацию. Движение дождя — дело видео.

Изменить свет — только по явной просьбе пользователя. Тогда правка готового кадра по образцу: второй картинкой кадр той же локации с нужным светом и `change ONLY the lighting and colour so they match image 2`. Слово `warm` без образца дало ядрёный оранжевый.

### Замок

Последняя строка — одна для всех планов. Она сохраняет image 1 и называет, кто в кадре; что люди добавлены, она не повторяет:

```text
Keep image 1 exactly as it is: the same camera position, angle and framing, every object in the same place and size, the same light and colours. The only people in the frame are character1 and character2.
```

Один человек: `… character1 is the only person in the frame.` Пользователь попросил изменить что-то на image 1 (убрать урну, открыть дверь): `Keep image 1 exactly as it is, except <изменение, как целевое состояние>: …`.

Если какой-то предмет уже пропадал или сдвигался, назвать его в замке: `the same window in the same place and size, the same handrail`.

Окружение не описывать. Исключение — предметы, которые пропадают, и предметы-ориентиры для места и масштаба.

Указания камеры (`low angle`, `ground level`, `top-down view`) не писать: ракурс задаёт image 1.

Если image 1 — только фрагмент (стена, несколько ступеней, фактура), для среднего и общего плана модель дорисует остальную комнату, и на каждом seed по-разному. Крупному плану фрагмента хватает: в ep2 крупный план на гладкой деревянной панели приняли с первого прогона. Для среднего и общего плана нужен вид локации, где видно всё место.

## Режимы

Сборка с нуля, когда меняется композиция. Правка готового кадра, когда изменение локальное:

```text
Edit image 1: <one change>. Keep EVERYTHING else exactly the same: <what must not move>.
```

`much less blood` может убрать кровь совсем. Писать целевое состояние: `a small red stain the size of a coin exactly at the nostril`.

Не больше одной-двух правок подряд. Дальше собирать заново из чистой локации.

## Что не писать

- Описание одежды, обуви, сумки и вещей. Только `exactly as in image N`, кроме явной просьбы пользователя.
- Одежду и вещи из shot.md, если они расходятся с референсом.
- Свой свет, цвет, погоду и эффекты, которых нет на image 1.
- Описание всего окружения и предметы, которых нет на image 1.
- Ракурс и движение камеры, «показать комнату ближе».
- Отрицание там, где можно сказать нужное состояние (см. «Писать, что нужно, а не чего не делать»).
- Одно требование дважды: второе предложение, которое добавляет людей, `Place … into` перед предложением «Add», замок, повторяющий, что люди добавлены, `Nothing changed.` после строк одежды.
- Строки, оставшиеся от прошлой версии промпта, которые больше не нужны запросу.
- `IMPORTANT`, капс и повтор одного требования.
- `small`, `correct scale`, `realistic proportions` без предмета.
- Длинный стилевой хвост. Хватает одной короткой строки в конце, если она нужна.

## Перед запуском

1. Сборка или правка.
2. План взят из shot.md или сообщения пользователя. Блок размера ему соответствует, камера и локация не двигаются.
3. Номера картинок — из «Images the graph receives». Люди — character1, character2 по этим номерам. Ни имён, ни имён файлов, ни путей.
4. Каждая картинка из списка названа в промпте. Для каждого портрета — строка `characterN's face exactly as in image N`.
4a. Одно предложение «Add» ставит людей на место; отдельного `Place … into` нет. Каждая мысль — один раз.
4b. Нет отрицаний там, где можно сказать нужное состояние. За каждым оставшимся `not` / `NOT` / `do not` стоит прогон.
5. Для каждого человека строка `clothes … exactly as in image N`. Одежда и вещи не описаны, кроме того, что пользователь явно попросил изменить.
6. Место описано через видимое на image 1, без новых предметов.
7. Общий план: рост привязан к предмету. Средний: где край кадра режет тело. Крупный: человек у самой камеры.
8. Одно действие, направление тела и взгляд с целью.
9. Референс не противоречит кадру. Если противоречит — `unlike image 2` или другой файл.
10. Детали только сюжетные или уже ломавшиеся.
11. Свет: `the same light as everything in image 1`, без своих цветов, погоды и эффектов.
12. Последняя строка — замок из раздела «Замок».
13. Короче ~200 слов.
14. Сразу 2–5 seed. Для двоих и для направления — 5–10.

## Пример, который приняли

Не сработало: длинная одежда, `wet pavement`, `one third of the frame height`, `Cinematic film still`. Фигура была крупной, студийной и стояла на газоне.

Принятый промпт (строки одежды, света и замок переписаны по нынешним правилам):

```text
character1 is image 2. Long shot. Add character1 running on the grey paved strip at the very bottom of the frame, right next to the curb of the road, in front of the grass; both boots on this strip. She is at the very left edge of the frame, just entering from the left, running from left to right, mid-stride, one hand on the bag strap, head turned up to the right, lost and panicked. She is fairly small: about one quarter of the frame height, in proportion to the birch tree and the parked car. character1's clothes, shoes, bag and everything she wears or carries exactly as in image 2. She is lit by the same light as everything in image 1, a dark figure, face in shadow. Keep image 1 exactly as it is: the same camera position, angle and framing, every object in the same place and size, the same light and colours. character1 is the only person in the frame.
```

## Принято в ep2: крупный и средний план

Крупный план (s03, принят на 13-м прогоне; прогоны 1–5 давали фигуру в полный рост, потому что в промпте было `She stands in the middle of the floor`). Строки одежды, света и замок переписаны по нынешним правилам:

```text
character1 is image 2. Close-up. Add character1 standing right in front of the camera, very close: her face fills most of the frame. She is turned to the left in profile and looks past the left edge of the frame, towards the far rows of the hall. Her expression is calm and composed.
character1's clothes exactly as in image 2. She is lit by the same light as everything in image 1.
Keep image 1 exactly as it is: the same camera position, angle and framing, every object in the same place and size, the same light and colours. character1 is the only person in the frame.
```

Если у character1 есть портрет, добавляется строка `character1's face exactly as in image 3`.

Средний план (s06, принят). Сработал, потому что локация уже снята с расстояния кафедры, а предмет (кафедра) режет тело:

```text
character1 is image 2. Medium shot. Add character1 standing behind the podium, his torso visible above the edge, shoulders and head clearly his own. The top of his head reaches about three quarters of the way up the tiered seating behind him. Both arms raised up at shoulder height, palms open, his mouth open, expression stern and commanding. He looks over the front rows towards the back of the hall, angry. His body leans forward over the podium. character1's clothes exactly as in image 2. He is lit by the same light as everything in image 1. Keep image 1 exactly as it is: the same camera position, angle and framing, every object in the same place and size, the same light and colours. character1 is the only person in the frame.
```

## Принято с двумя людьми (лавка, эпизод 4)

Пользователь сам поправил промпт агента: люди добавляются одним предложением вместе с местом, а замок не повторяет, что их добавили.

```text
character1 is image 2: a very tall, slim young man in an off-white jacket. character2 is image 3 and the face from image 4: a slim young woman with long dark brown hair and a black leather jacket.
Medium shot. Add character1 and character2, both sit on the wooden bench from image 1, on the right of the frame, backs against the backrest, close to the camera, with a small gap of empty seat between them. The bottom edge of the frame cuts them just above the knees, heads in the upper third.
character2 sits on the left half, leaning back, looking straight ahead along the path, a faint relieved smile. character1 sits on the right half, leaning back, looking straight ahead along the path, very calm, a slight smile. Each holds a waffle cone with vanilla ice cream.
character2's face exactly as in image 4. character1's clothes exactly as in image 2. character2's clothes exactly as in image 3.
They are lit by the same light as everything in image 1.
Keep image 1 exactly as it is, except the dark bin beside the bench is gone, with plain asphalt and leaves where it stood: the same camera position, angle and framing, the same bench with green cast-iron ends in the same place and size, the same lamp posts, hedge and trees, the same light and colours. The only people in the frame are character1 and character2.
```

Прошлая версия этого промпта говорила `Place them into the park path from image 1`, а потом `Both sit on the bench`: два места для одних и тех же людей и два указания их добавить.
