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
Place the girl from image 2 into the <place, one word> from image 1.
<where, described by what is visible on image 1>
<size in the frame: by the shot size, see «Shot size»>
<one action, body direction, where they look>
<only a story detail, or a detail that already broke>
Her clothes, shoes, bag and everything she wears or carries exactly as in image 2, unchanged.
No special lighting on her: she is lit by the same light as everything in image 1.
<lock, see «Lock»>
```

Для мужчины `girl` меняется на `man`, `her`/`she` — на `his`/`he`.

### Номера картинок

В задаче есть список «Images the graph receives» — какие картинки получит граф и что на каждой. Номера брать ровно оттуда. image 1 — локация. Дальше персонажи по алфавиту имён, а не в порядке shot.md: у Лены и Юли Юля — image 2, Лена — image 3. Дальше портреты этих персонажей в том же порядке: Юлин портрет — image 4, Ленин — image 5. Всего до 6 картинок; что не влезло, задача называет отдельно, на это не ссылаться.

Все картинки из списка уходят в модель, поэтому в промпте названа каждая: кто на ней и зачем она. Картинка без слов в промпте сбивает модель: она не знает, куда её деть, и может вписать портрет вторым человеком.

Если людей двое, у каждого в первом предложении имя и номер, дальше — по именам: `Place Julia (image 2) and Lena (image 3) into the lecture hall from image 1.` В ep2 промпты писали `Lena from image 2`, а image 2 была Юля, и девять прогонов девушки менялись ролями.

Внешность по памяти не описывать: волосы, очки, одежда берутся с референса. Неверное описание (`Lena in her sweater`, хотя свитер у Юли) тянет модель не к тому человеку.

Имена файлов и пути (`refs/portret.png`, `shots/s10/...`) в промпт не писать. Модель видит только картинки по номерам. Промпт с именем файла доска не запустит.

### Что и куда

Коротко: `Place the girl from image 2 into the street from image 1`.

### Одежда и вещи

Одежда, обувь, сумка, шапка, зонт и прочие вещи — с референса персонажа, без изменений. Их не описывать: ни цвет, ни фасон, ни размер, ни «закрыта», ни «на плече». Любое описание модель рисует по-своему: в episode3 фраза `a large black shoulder bag, big enough to hold several books` дала другую сумку, и пользователь четыре раза писал «сумка мешок».

Вместо описания — одна строка на каждого человека:

- Один: `Her clothes, shoes, bag and everything she wears or carries exactly as in image 2, unchanged.`
- Двое: `Ivan's clothes exactly as in image 2. Lena's clothes and bag exactly as in image 3. Nothing changed.`

Одежду из текста кадра (shot.md) не брать: если она расходится с референсом, верен референс.

Менять одежду или вещи — только по явной просьбе пользователя («без куртки», «рукава закатаны», «добавь сумку-мешок на плечо»). Тогда одна строка про это изменение, а остальное по-прежнему `exactly as in image 2`. Если просят вещь, которая на референсе уже есть, — не описывать её заново, а написать `her bag exactly as in image 2`.

### Где именно

Модель плохо понимает «тротуар» и «край кровати» на конкретной картинке.

`She runs on the sidewalk` несколько раундов подряд оставляло её на газоне. Сработало: `She runs on the grey paved strip at the very bottom of the frame, right next to the curb of the road, in front of the grass`.

Место описывать так, как оно выглядит на image 1: цвет, соседние предметы, часть кадра. Это описание — ориентир для человека, а не новое описание локации: не добавлять предметов, которых на image 1 нет.

### План кадра

План берётся из первых слов текста кадра (`Close up`, `Medium shot`, `Long shot`). Сообщение пользователя важнее shot.md: «ещё ближе», «очень крупный план» — это крупный план. У каждого плана свой блок размера. Замок один для всех (см. «Замок»).

Камера и локация не двигаются ни на каком плане. План получается только тем, насколько близко к камере стоит человек.

**Общий план.** Человек небольшой в комнате. Рост привязать к предмету: `the top of her head is at the height of the window sill`. `her head at three quarters of the wardrobe's height`. `the SAME HEIGHT as the girl, the top of his head at the same level as hers`. `small`, `correct human scale`, `do not make her big` не работали. `about one quarter of the frame height` помогает частично. Ближний план делает фигуру крупнее — уравновесить долей кадра. Доли кадра — только здесь.

**Средний план.** Размер — через то, где край кадра режет тело, а не долей: `she is close to the camera, visible from the waist up, the bottom edge of the frame cuts her at the waist, her head in the upper third of the frame`. За партой: `the desk edge crosses her at the waist`. Не писать `stands in the middle of the floor`, `one third of the frame height` и всё, где видны ноги: с референсом в полный рост одно слово `stands` даёт фигуру с сапогами.

**Крупный план.** Человек у самой камеры: `She stands right in front of the camera, very close: her face and shoulders fill most of the frame, her eyes in the upper third.` Затем взгляд и выражение. Ни слова про пол, ноги и всю фигуру. Локация за ней та же, что на image 1, ничего не перерисовывается.

Если локация снята слишком издалека и человек на нужном плане в неё не помещается — это работа этапа локации (другой вид места), а не этого промпта. Не просить модель «приблизить» или «показать ближе» комнату: в episode3 так она перерисовывала лестницу и стены.

### Портреты

В списке «Images the graph receives» после персонажей идут их портреты (`portrait of julia`). Доска отправляет их всегда, если портрет есть. Для каждого портрета в промпте одна строка: чьё это лицо, по номеру.

- С одним человеком: `Image 3 is her portrait: her face exactly as in image 3, the same eyes, nose, lips and skin.`
- С двумя: `Julia's face exactly as in image 4, Lena's face exactly as in image 5.`
- Портрет — только лицо. Одежда, поза и рост — с референса персонажа (image 2, image 3). Не писать `the girl from image 4`: модель добавит лишнего человека.

Портреты идут после персонажей, поэтому номера локации и персонажей не зависят от того, есть ли портрет.

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

Свет и цвет локации не меняются. Человек получает тот свет, который уже есть на image 1, а не свой.

Одна строка: `No special lighting on her: she is lit by the same light as everything in image 1.` При необходимости: `slightly underexposed like everything around`.

Не называть свой свет и цвет: ни `harsh yellow lamp`, ни `cold blue-grey cast`, ни `dim blue twilight`, если агент не уверен, что это именно то, что видно на image 1. Названный цвет модель красит на всю картинку: в episode3 пользователь писал «свет тоже не меняй». `match the lighting` почти ничего не даёт: персонаж остаётся студийным и светлее комнаты, поэтому нужна строка выше.

Погоду и эффекты (дождь, туман, лучи, отражения), которых нет на image 1, не добавлять: это меняет локацию. Движение дождя — дело видео.

Изменить свет — только по явной просьбе пользователя. Тогда правка готового кадра по образцу: второй картинкой кадр той же локации с нужным светом и `change ONLY the lighting and colour so they match image 2`. Слово `warm` без образца дало ядрёный оранжевый.

### Замок

Последняя строка — одна для всех планов:

```text
Keep image 1 exactly as it is: the same camera position, angle and framing, the same objects in the same places, nothing added, nothing removed, nothing moved, the same light and colours. Only the people are added. Do not add any other people.
```

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
- Отрицание без позитивной замены: `not on the grass` слабее, чем описание серой полосы у бордюра.
- `IMPORTANT`, капс и повтор одного требования.
- `small`, `correct scale`, `realistic proportions` без предмета.
- Длинный стилевой хвост. Хватает одной короткой строки в конце, если она нужна.

## Перед запуском

1. Сборка или правка.
2. План взят из shot.md или сообщения пользователя. Блок размера ему соответствует, камера и локация не двигаются.
3. Номера картинок — из «Images the graph receives». У каждого человека имя и номер. Ни имён файлов, ни путей.
4. Каждая картинка из списка названа в промпте. Для каждого портрета — строка `<Name>'s face exactly as in image N`.
5. Для каждого человека строка `clothes … exactly as in image N`. Одежда и вещи не описаны, кроме того, что пользователь явно попросил изменить.
6. Место описано через видимое на image 1, без новых предметов.
7. Общий план: рост привязан к предмету. Средний: где край кадра режет тело. Крупный: человек у самой камеры.
8. Одно действие, направление тела и взгляд.
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
Place the girl from image 2 into the street from image 1. She runs on the grey paved strip at the very bottom of the frame, right next to the curb of the road, in front of the grass; both boots on this strip. She is at the very left edge of the frame, just entering from the left, running from left to right, mid-stride, one hand on the bag strap, head turned up to the right, lost and panicked. She is fairly small: about one quarter of the frame height, in proportion to the birch tree and the parked car. Her clothes, shoes, bag and everything she wears or carries exactly as in image 2, unchanged. No special lighting on her: she is lit by the same light as everything in image 1, a dark figure, face in shadow. Keep image 1 exactly as it is: the same camera position, angle and framing, the same objects in the same places, nothing added, nothing removed, nothing moved, the same light and colours. Only the people are added. Do not add any other people.
```

## Принято в ep2: крупный и средний план

Крупный план (s03, принят на 13-м прогоне; прогоны 1–5 давали фигуру в полный рост, потому что в промпте было `She stands in the middle of the floor`). Строки одежды, света и замок переписаны по нынешним правилам:

```text
Place the girl from image 2 into the lecture hall from image 1. She stands right in front of the camera, very close: her face fills most of the frame, an extreme close-up. She is turned to the left in profile. She looks to the left, NOT at the camera. Her expression is calm and composed. She gazes thoughtfully around the room.
Her clothes exactly as in image 2, unchanged. No special lighting on her: she is lit by the same light as everything in image 1.
Keep image 1 exactly as it is: the same camera position, angle and framing, the same objects in the same places, nothing added, nothing removed, nothing moved, the same light and colours. Only the people are added. Do not add any other people.
```

Если у Лены есть портрет, добавляется строка `Her face exactly as in image 3`.

Средний план (s06, принят). Сработал, потому что локация уже снята с расстояния кафедры, а предмет (кафедра) режет тело:

```text
Place the professor from image 2 into the lecture hall from image 1. He stands behind the podium, his torso visible above the edge, shoulders and head clearly his own. The top of his head reaches about three quarters of the way up the tiered seating behind him. Both arms raised up at shoulder height, palms open, his mouth open, expression stern and commanding. He looks straight ahead and slightly down, angry, NOT at the camera. His body leans forward over the podium. His clothes exactly as in image 2, unchanged. No special lighting on him: he is lit by the same light as everything in image 1. Keep image 1 exactly as it is: the same camera position, angle and framing, the same objects in the same places, nothing added, nothing removed, nothing moved, the same light and colours. Only the people are added. Do not add any other people.
```
