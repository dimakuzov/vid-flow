# MiniMax H3 Cinema (эскиз видео и финал): как писать промпт

Оригинал на русском. Для агента: `playbooks/models/minimax_h3.en.md`.

Этот плейбук у двух вариантов: `video_minimax` на эскизе видео (граф `minimax_h3_preview_api.json`, один проход 0.5 Мп) и `final_h3_cinema` на финале (граф `minimax_h3_cinema_api.json`, второй проход с апскейлом латента до 1.5 Мп). Оба — MiniMax H3 **по референсам** (reference to video) с ЛоРой Cinema. Видео-референса нет: модель получает утверждённый первый кадр, по картинке на каждого персонажа, референсы, которые пользователь дал кадру, и текст. Всё движение задаёт текст. Пользователь выбрал этот граф, потому что он стабильно держит качество и сходство людей; старый граф H3 с low-res видео как референсом часто ломался.

---

## 1. Что получает модель

| Метка | Что | Откуда |
| --- | --- | --- |
| `<Picture 1>` | утверждённый первый кадр: место, камера, люди в своей одежде | `first_frame/approve/` (самый новый) |
| `<Picture 2>`, `<Picture 3>`, … | по картинке на персонажа, в порядке списка в задаче: лист лица (несколько видов одного лица на одной картинке), иначе одно лицо, иначе утверждённый персонаж | `refs/` этого этапа (`{имя}_face_sheet`, затем `{имя}_face`), иначе библиотека (`*face_sheet*`, затем портрет), иначе `characters/approve/` |
| следующие картинки, после лиц | референс, который пользователь дал кадру: машина, вещь, деталь места; не человек | `refs/` этого этапа, кроме файлов персонажей; иначе, на финале, `refs/` превью; иначе `refs/` первого кадра. Лица и референсы вместе — не больше 6 картинок |
| длительность | эскиз: меню этапа (иначе `N sec` в `prompt.md`); финал: длина утверждённого превью | доска |
| текст | `prompt.md` как есть | этот этап |

В задаче список «Images the graph receives»: метки картинок и кто на какой. Метки брать ровно оттуда. В задаче есть длительность клипа, а на финале — промпт утверждённого превью (движение, которое нужно сохранить).

## 2. `prompt.md` — это ровно текст для модели

Без заголовков `##` и без Markdown. Разделы — обычные строки с двоеточием, в этом порядке. Только английский.

```text
subject_definitions ASTROCINEMAV01K2T:
<Subject 1> is the young woman defined by <Picture 2>. Use <Picture 2> for her face: <hair, face, a few words>. Her clothes and body are the ones already on her in <Picture 1>. <what she holds, if it matters>
<Subject 2> is the young man defined by <Picture 3>. Use <Picture 3> for his face: <hair, face, a few words>. His clothes and body are the ones already on him in <Picture 1>.

<Picture 1> is the opening frame and the place. The video begins on this exact picture: the same camera, the same framing, the same people in the same poses, the same clothes, the same light, every object in its place.

summary:
[reference generation] A <N>-second shot. <Picture 1> is the first frame. <Picture 2> is <Subject 1>'s face. <Picture 3> is <Subject 2>'s face.

retention_analysis:
Every person keeps the face from their picture and the clothes already on them in <Picture 1>. fully_preserved through the whole shot.

detailed_description:
The shot lasts <N> seconds and never cuts.

[Shot 1] <camera>. <where everyone is, exactly as in <Picture 1>>. <the action, in order, with timing>. <the lines>. <how the shot ends>.

overall_soundscape:
<the sound of the place and of the action>

non_diegetic_music:
None.
```

1. **Первая строка всегда `subject_definitions ASTROCINEMAV01K2T:`.** `ASTROCINEMAV01K2T` — слово-триггер ЛоРы Cinema. Если строки нет, доска поставит её первой; лучше написать самому, чтобы она не задвоилась.
2. **Люди — `<Subject 1>`, `<Subject 2>`, …** в порядке списка в задаче. Имён из задачи, текста кадра и файлов нет.
3. **Каждый человек привязан один раз**, в `subject_definitions`, к своей картинке. Для листа лица (в списке «face sheet»): `Use <Picture N> for her face: it shows the same face from several angles.` Лист — один человек, а не несколько. Для одного лица: `Use <Picture N> for her face`. Для утверждённого персонажа (в списке «approved figure and clothes»): `<Subject N> is the young man defined by <Picture N>: his face and hair as in <Picture N>`. Одежда всегда берётся с `<Picture 1>`: в ней люди уже стоят в первом кадре.
4. **Несколько слов, по которым человека узнать** (волосы, лицо), как на картинке. Одежду не перечислять: её показывает `<Picture 1>`.
5. **`<N>`** — длительность клипа из задачи, в `summary` и в `detailed_description`.
6. **`summary`** называет каждую картинку один раз: первый кадр, затем чьё лицо на каждой, затем что на каждом референсе: `<Picture 4> is the patrol car.`
   Референс (в списке «a reference the user gave this shot») — не человек, `<Subject N>` у него нет. Он привязан один раз, в `subject_definitions` после людей, к вещи, которую показывает: `The patrol car is the one in <Picture 4>: its colour, shape and markings exactly as in <Picture 4>.` Дальше в `detailed_description` это просто `the patrol car`. Что это за вещь — из сообщения и замечаний пользователя; цвет — с картинки: цвет вещи писать только такой, как на ней и на `<Picture 1>`.
7. **`retention_analysis`** — `fully_preserved`. `partially_preserved` или «adapted» разрешают модели менять людей.
8. **`non_diegetic_music:`** — `None.`, если пользователь не просит музыку.

## 3. `detailed_description`: движение

Видео, с которого можно скопировать движение, нет, поэтому всё движение — в тексте.

1. **Откуда движение.** На эскизе видео: действие кадра и замечания пользователя говорят, что происходит; описание первого кадра — где все стоят в начале. На финале: в задаче есть промпт утверждённого превью; сохранить его движения, их порядок и время, переписав в этой форме (промпт превью MiniMax уже в ней). Если текущий `prompt.md` в форме другого воркфлоу (LTX: `use image as the first frame.`), переписать его в этой форме, сохранив содержание.
2. **Начало — это `<Picture 1>`.** Места, позы и взгляд — как в первом кадре; действие продолжается оттуда.
3. **Камера одной-двумя короткими фразами**, в начале и в конце: `A static medium shot at seated height.` … `The camera holds unmoving.` Если камера в кадре движется — одно движение и его скорость.
4. **Время**: `for one second, then…`, `at the same moment…`, `only at the very end…`. Действие заполняет всю длительность; последняя фраза — чем кадр заканчивается: `until the end of the shot both stay seated`.
5. **Взгляд с целью**: `looks along the path at the far lamp post`, `looks at <Subject 2>`.
6. **Свет**: одна фраза — тот свет, что есть на `<Picture 1>`, по описанию первого кадра. Своего света не придумывать.

### Реплики

Реплики кадра (раздел «Lines» задачи, `speech.md`) идут в `detailed_description` в тот момент, когда звучат, в разметке модели: `<Subject 1> says quietly, <d>[English] It is kind of scary.</d>` Одна фраза на реплику, говорящий по метке, слова внутри `<d>[English] …</d>`. Английская реплика переносится дословно. Реплика с кириллицей пишется по-английски. В `overall_soundscape` реплик нет. Реплик в задаче нет — никто не говорит.

Пока кто-то говорит, сказать, что делают остальные: `At the same moment <Subject 2> stays seated and slowly licks his ice cream.`

## 4. Слова, из-за которых модель делает другое

Уроки прошлого графа H3 по тексту остаются в силе:

| Слово в тексте | Что делает модель | Вместо этого |
| --- | --- | --- |
| close-up, focusing on her face | приближает камеру | план `<Picture 1>` + что в кадре |
| looks around, glancing | вертит головой | looks at <цель>, взгляд остаётся там |
| hurries, urgent, frantic | дёргается | steady, even pace |
| camera pans / follows | двигает камеру | static shot, the camera holds |
| pours, boiling, splashing | брызги, блики | a slow, thin, gentle trickle |
| crystalline, glass, glint, shiny | искры, блеск | matte, soft diffused light |
| действие, которое уже видно на `<Picture 1>` | повторяет его | already there in `<Picture 1>` and stays as it is |

**Писать, что должно быть, а не чего быть не должно.** `no sparkles` даёт искры. Прежде чем писать `not`, `no`, `never`, `do not`, найти, что в тексте может вызвать нежелательное, и заменить нужным состоянием (`matte surfaces, calm air`). Отрицание остаётся, только если прогон уже показал ошибку, а позитивная формулировка её не исправила.

**Короче — лучше.** Каждое удачное исправление заменяло или убирало фразу. Новые события, чтобы заполнить время (взгляды, паузы), заставляют людей импровизировать.

## 5. Перед запуском

1. Первая строка — `subject_definitions ASTROCINEMAV01K2T:`.
2. Каждая картинка из списка названа той же меткой; каждый человек привязан к своей картинке один раз; имён нет.
3. `<N>` — длительность клипа из задачи.
4. `retention_analysis`: `fully_preserved`.
5. Движение — по действию кадра и замечаниям (на финале — по утверждённому превью); начало совпадает с `<Picture 1>`; камера названа в начале и в конце; кадр кончается без нового события.
6. Каждая реплика из `speech.md` — в `detailed_description` в `<d>[English] …</d>`; в звуке реплик нет.
7. Нет слов из таблицы раздела 4; нет отрицаний там, где можно сказать нужное состояние.
8. `non_diegetic_music: None.`, если не просили.

## 6. Варианты и выбор по умолчанию

Эскиз видео: по умолчанию LTX (`video_ltx`); «▶ Все кадры» гонит на каждом кадре сначала LTX, затем этот вариант MiniMax. Таблица — `playbooks/stages/video_preview.md`.

Финал (таблица — `playbooks/stages/final_render.md`) идёт за утверждённым превью: превью MiniMax делает по умолчанию `final_h3_cinema`, превью LTX — `final_ltx`. Иначе один говорящий — по умолчанию `final_h3_cinema`; двое и больше — HeyGen (`final_heygen`, облако только после галочки пользователя на один запуск); никто не говорит — Wan (`final_wan_720`). Если выбранный вариант не подходит кадру, впиши его id в `suggestedWorkflow` в `agent_request.json`.
