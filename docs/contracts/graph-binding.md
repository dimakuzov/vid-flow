# Контракт: манифест привязки графа

Типы: `src/lib/contracts/graph-binding.ts`. Проверка: `src/lib/contracts/graph-binding.test.ts` (`npm test`).

Граф ComfyUI в формате API и код доски связаны только через манифест. Код не знает node id. Новый воркфлоу = положить в `playbooks/workflows/comfy/` JSON графа и `<id>.bind.json`, без правки кода.

## Где лежит

```
playbooks/workflows/comfy/
  location_views_multiple_angles.json   # граф (формат API)
  location_views.bind.json              # манифест, id = имя файла без .bind.json
```

Один граф может иметь несколько манифестов (например, `video_i2v` для превью и `final_i2v` для финала).

## Несколько воркфлоу на этап

- У каждого манифеста ровно один `stage` и `order`.
- Меню этапа — все манифесты этого этапа по `order` (`StageDetail.workflows`, тип `WorkflowChoice`).
- Вариант доступен (`available`), если все обязательные входы на месте; иначе `missing` перечисляет подписи недостающих входов.
- **По умолчанию** — первый доступный, у которого совпал `whenSketch` (эскиз LTX → финал LTX); иначе первый доступный, чей `defaultWhen` подходит кадру (`speech` / `dialogue` / `silent`); иначе первый доступный по `order`. Доступных нет — первый по `order`. Доска сама выбор не меняет: `suggestedWorkflow` только показывает.
- Выбор пользователя хранится в `run_settings.json` этапа (`{ "workflow": "<id>" }`), пишет только доска (`PATCH .../stages/{stage}` с полем `runWorkflow`; пустая строка — сбросить на вариант по умолчанию).
- Запуск: `runWorkflow` из тела `POST .../run` → иначе `run_settings.json` → иначе по умолчанию. Старые имена `i2v`/`flf` принимаются через `aliases`.
- Агент может предложить другой вариант (`suggestedWorkflow` в `agent_request.json`, см. `agent-request.md`). Доска показывает предложение, сама не переключает.
- Этап без манифестов доска не запускает (сейчас `characters`).

Функции (модуль 3, `src/lib/comfy/workflows.ts`): `listWorkflowChoices(ep, shot, stage)`, `resolveWorkflowId(ep, shot, stage, requested)`. Сигнатуры зафиксированы. Сейчас тело — временный список по текущему коду; модуль 3 заменяет его чтением манифестов.

## Формат

```json
{
  "format": "frameboard.graph-binding/1",
  "id": "first_frame_compositing",
  "graph": "qwen21_character_compositing.json",
  "stage": "first_frame",
  "label": "Первый кадр: персонажи в локации",
  "description": "Вписать утверждённых персонажей (1–2) в утверждённую локацию.",
  "playbook": "models/qwen_first_frame.en.md",
  "order": 10,
  "aliases": [],
  "inputs": { "...": "см. ниже" },
  "slots": [ "...см. ниже" ]
}
```

| Поле | Что |
|---|---|
| `id` | уникальный, = имя файла. Пишется в `run_settings.json` и в задание очереди (`ComfyJob.workflow`) |
| `graph` | файл графа рядом |
| `label` | название в меню, по-русски, для пользователя |
| `description` | одна строка: когда выбирать |
| `playbook` | плейбук модели для агента (`.en.md`), путь от `playbooks/`. Агент пишет `prompt.md` по шаблону оттуда |
| `order` | порядок в меню, без повторов внутри этапа |
| `aliases` | старые имена для совместимости |

### `inputs` — обязательные входы

Именованные. Три вида:

```json
"location": { "kind": "image", "from": "approve:location", "pick": "newest", "label": "Утверждённая локация" },
"people":   { "kind": "image", "from": "approve:characters", "pick": "all", "min": 1, "max": 2, "label": "Утверждённые персонажи" },
"view":     { "kind": "image", "from": ["refs", "library:location"], "pick": "first", "label": "Общий вид" },
"end":      { "kind": "image", "from": "refs", "pick": "newest", "uploadAs": "{shotId}_end{ext}", "label": "Последний кадр в refs/" },
"text":     { "kind": "text", "from": "prompt", "required": true, "label": "prompt.md" },
"seconds":  { "kind": "number", "from": "settings:seconds", "fallback": "prompt:seconds", "min": 2, "max": 12, "label": "Длительность клипа" }
```

Картинки (`kind: image`):

| `from` | Откуда |
|---|---|
| `refs` | `refs/` этого этапа |
| `approve:<stage>` | `approve/` другого этапа этого кадра |
| `library:location` | `data/locations/<location из shot.md>/`: `view.png`, иначе первая картинка без `copy` в имени |
| `library:faces` | лица персонажей: по одному на файл в `approve/` этапа characters, в том же порядке (по алфавиту). `refs/{name}_face.*` этого этапа, иначе в `data/characters/{name}/` — `face`, `portrait`, `portret` (в том числе `{name}_portret`, `portret_{name}`), иначе первая картинка с face/portr в имени без side и copy. Персонаж без лица пропускается |
| массив | источники по порядку, берётся первый непустой |

`pick`: `first` — первая по имени (числа по значению), `newest` — самая новая по mtime, `all` — все по имени, не больше `max`. `min` (по умолчанию 1) — сколько нужно для `available`; `min: 0` — вход необязательный. `uploadAs` — имя файла при загрузке в ComfyUI: `{shotId}`, `{episodeId}`, `{index}`, `{ext}` (расширение с точкой, в нижнем регистре, по умолчанию `.png`); без него — имя файла.

`requireSpeech: true` (у входа `text`) — каждая реплика из `speech.md` кадра должна стоять в тексте дословно (регистр, пробелы, кавычки и многоточие не считаются), иначе запуск — ошибка со списком недостающих. Стоит у MiniMax H3: модель сама озвучивает кадр.

`defaultWhen` (у манифеста): `speech` — вариант может быть по умолчанию, только если в кадре есть реплики; `dialogue` — реплики от двух и более разных говорящих (имена перед двоеточием в `speech.md`); `silent` — только если реплик нет.

`whenSketch` (у манифеста) важнее `defaultWhen`. Вариант становится умолчанием, если самый новый ролик входа `of` (kind: video, `pick: newest`) сделан указанным графом:

- в метаданных есть ключ `prompt`, и нашлась первая нода из `nodes` (`{ node, field }`), у которой в сохранённом графе непустой текст;
- ключа нет — запасной признак `filename`, подстрока имени файла (`_ltx`). Имя не смотрится, если метаданные есть: файл могли переименовать при утверждении.

Ноды `whenSketch` относятся к графу, которым сделан ролик, а не к графу этого манифеста: код их против своего графа не проверяет. Совпавший вариант недоступен (нет входов) — обычные правила `defaultWhen`. Подходящего доступного нет — первый доступный по `order`.

`target: "cloud"` + `cost: { credits, perSeconds }` (у манифеста) — прогон идёт в Comfy Cloud (`COMFY_CLOUD_API_KEY` в `.env.local`), платно. `queueStageRun` ставит его только с `allowCloud: true` — галочка на странице этапа, на один запуск (`POST .../run` `{ allowCloud: true }`, или `.../agent-request` `{ allowCloud: true }` — тогда доска запустит облако после ответа агента). Без разрешения — ошибка; кнопки таблицы такие кадры не отправляют. `WorkflowChoice.cloud` — цена для окна разрешения.

`clamp: true` (у числа) — значение вне `min..max` прижимается к границе, а не отбрасывается. `{ "seed": "random", "max": N }` — случайный seed не больше `N` (HeyGen: 4294967295). Подходящего доступного нет — первый доступный по `order`.

`whenPrompt` — регэксп (флаг `i`): вход подключается, только если `prompt.md` этапа с ним совпал; иначе вход пуст и срабатывает `whenEmpty`. Так агент сам решает, нужен ли вход. Вход с `whenPrompt` обязан быть необязательным (`min: 0`). Пример: `"whenPrompt": "\\bface from image \\d+\\b"` — вход уходит, только если агент написал эту фразу (так раньше подключались лица первого кадра; теперь портреты уходят всегда). Номера картинок агент видит в задаче («Images the graph receives»).

В `prompt.md` нельзя писать пути и имена файлов (`refs/x.png`, `lena_s01.png`): модель видит картинки только по номерам. Такой промпт доска не запускает.

Текст (`kind: text`):

- `from: "prompt"` — `prompt.md` этапа, `trim()`, **без фильтров**. `required: true` — пустой `prompt.md` даёт ошибку при запуске.
- `from: "approve-meta"` — текст ноды из метаданных самого нового ролика входа `of` (kind: video, `pick: newest`). `nodes` — пары `{ node, field }` в сохранённом графе; берётся первая с непустым текстом. Так один манифест читает и Wan (`129:93` / `text`), и LTX (`398:376` / `value`): ноды перечислены в манифесте, код их не знает и против графа этого варианта не проверяет. `fallback: "prompt"` — нет ролика, нет ключа `prompt` или нет текста ни в одной ноде: взять `prompt.md` этапа `stage` (нет `stage` — этап запуска). Доска дописывает пометку в `run_log.md` этапа запуска. Та же строка — `sketchPromptTaskNote` в `binding.ts` (её место в задаче агента — `docs/contracts/agent-request.md`).

На `available` текст и число не влияют: промпт часто пишет агент уже после выбора варианта.

`prompt.md` из старых кадров может начинаться с инструкции доски («Собери shot-вариант…», «Правила: playbooks/…»). Такой текст в модель не отправляется: запуск падает с понятной ошибкой «перепиши prompt.md» (вместо прежнего тихого вырезания строк регэкспами).

Число (`kind: number`, `from: prompt:seconds`): секунды из `prompt.md` («5 сек», «5s», «5 с»), в пределах `min..max`. Нет числа — значение графа не меняется.

### Длительность из меню: `settings:seconds`

Число `from: "settings:seconds"` — выбор пользователя в меню этапа: `durationSec` из `run_settings.json`. Выбрано, но вне `min..max` этого манифеста — считается «не выбрано».

- Не выбрано — источник `fallback`. Сейчас допустим только `"prompt:seconds"` (секунды из `prompt.md`, как выше). Нет `fallback` или и там числа нет — значение графа не меняется.
- `min` и `max` обязательны, целые, `min <= max`: по ним доска строит меню (целые секунды, шаг 1). `fallback` у других источников — ошибка манифеста.
- Выбран отдельный источник с запасным, а не новый смысл у `prompt:seconds`: старые манифесты (`prompt:seconds`, `final_*`) работают как раньше, порядок «меню → prompt.md → граф» виден в самом манифесте.
- У манифеста не больше одного такого входа: меню одно на этап.

Меню (`StageDetail.durationRange: { min, max, default } | null`) строится по воркфлоу, который уйдёт в запуск (выбор этапа или вариант по умолчанию). `default` — что уйдёт без выбора: секунды из `prompt.md` (если `fallback`), иначе значение графа в первом target слота этого входа. `null` — у воркфлоу нет входа `settings:seconds`, меню не показывается. `StageDetail.durationSec` — выбор (в пределах этого меню) или `null`.

Выбор пишет только доска: `PATCH .../stages/{stage}` с полем `runDuration` — целое секунд (число или строка из селекта); пустая строка или `null` — сбросить на «по умолчанию». Вне `min..max`, не целое, у воркфлоу нет меню — 400. `runWorkflow` и `runDuration` меняют только своё поле `run_settings.json`.

Агенту выбор уходит строкой в задаче: в `llm_task.md` — «Длительность клипа: N с. Действие должно уложиться в это время.», в text-режиме (`AgentTask.user`) — `clip duration: N s …`. Плейбук модели (`wan_video`, раздел 8, правило 7): `N sec` в `prompt.md` тогда не писать.

### `slots` — куда в графе

```json
{ "targets": [{ "node": "470", "field": "image" }], "value": { "input": "location" } }
{ "targets": [{ "node": "903", "field": "image" }], "value": { "input": "people", "index": 1 },
  "whenEmpty": { "remove": [{ "node": "903" }, { "node": "488", "field": "images.image_3" }] } }
{ "targets": [{ "node": "102", "field": "seed" }, { "node": "112", "field": "seed" }], "value": { "seed": "random" } }
{ "targets": [{ "node": "104", "field": "filename_prefix" }], "value": { "template": "frameboard/location/{shotId}_v1_simple" } }
```

`targets` — пары нода/поле `inputs`. И нода, и поле обязаны быть в графе, иначе ошибка с именем манифеста, ноды и графа (не тихий прогон). Одно значение пишется во все `targets`; `seed: random` — своё случайное число на каждый target.

`value`:

| Вид | Что подставляется |
|---|---|
| `{ input, index? }` для картинки | имя загруженного файла (`index` — номер во входе, по умолчанию 0) |
| `{ inputs: [...], index }` | файл номер `index` из входов подряд (все файлы первого, затем второго…). Так первый кадр заполняет `image_2`…`image_6` персонажами и их портретами без пропусков. Слот обязателен, только если `index` меньше `min` первого входа |
| `{ input, steps?, templates? }` для текста | текст входа после `steps`, затем первый подходящий шаблон |
| `{ input }` для числа | число |
| `{ seed: "random" }` | новое случайное целое |
| `{ template }` | строка: `{shotId}`, `{episodeId}`, `{stageId}`, `{workflow}` |

`whenEmpty.remove` — если значения нет (картинки с таким `index` нет, текста нет, числа нет): удалить ноды (без `field`) или ключи `inputs` (с `field`). Без `whenEmpty`: для обязательного входа — ошибка, иначе оставить значение графа.

### Текст: `steps` и `templates`

Всё, что доска добавляет к `prompt.md`, видно в манифесте. Других правок текста в коде нет.

```json
"steps": [
  { "namesTo": "the person" },
  { "ensure": "Static shot, fixed camera.", "at": "start", "unless": "\\b(camera|shot|static)\\b", "separator": " " },
  { "ensure": "Realistic, natural movement.", "at": "end", "unless": "realistic, natural movement", "separator": " " }
]
```

- `namesTo` — имена персонажей из `shot.md` (как слова, без учёта регистра, длинные первыми) заменить фразой; двойные пробелы схлопнуть.
- `ensure` — добавить фразу в начало или конец через `separator`, если текст не совпадает с регэкспом `unless` (флаг `i`). Пустой текст — фраза без разделителя.

```json
"templates": [
  { "when": { "input": "people", "countAtLeast": 2 }, "text": "Place the person from image 2 and the person from image 3 into the location from image 1.\n{text}\nKeep the location from image 1 exactly as it is." },
  { "text": "Place the person from image 2 into the location from image 1.\n{text}\nKeep the location from image 1 exactly as it is." }
]
```

Берётся первый шаблон, у которого выполнено `when` (число картинок во входе), или без `when`. Плейсхолдеры: `{text}`, `{shotId}`, `{episodeId}`. Строка, которая после подстановки пуста и состояла только из плейсхолдера, удаляется целиком.

Направление (бриф 4): лучше, когда обвязка живёт в шаблоне `prompt.md` из плейбука модели, а манифест подставляет `{text}` как есть. `steps`/`templates` нужны, чтобы старое поведение было видно и менялось без кода.

### Разделы `prompt.md`

Когда графу нужно несколько текстов (4 ветки локации, разделы Refine у MiniMax H3), `prompt.md` делится заголовками `## <имя>`:

```json
"text": { "kind": "text", "from": "prompt", "required": true,
          "sections": ["simple", "objects", "camera", "camera_objects"], "untitled": "all", "label": "prompt.md" }
```
```json
{ "targets": [{ "node": "100", "field": "value" }], "value": { "input": "text", "section": "simple" },
  "whenEmpty": { "remove": [{ "node": "104" }] } }
```

- `sections` — разрешённые имена (строчная латиница, цифры, `_`). Другое имя, повтор раздела, текст до первого заголовка — ошибка с понятным текстом.
- `untitled` — куда идёт текст без заголовков: `all` — во все разделы (как было до разделов), имя — только в этот раздел.
- Пустой раздел — `whenEmpty` (у локации: удалить ноду сохранения, ветка не выполняется). `required: true` у значения — пустой раздел даёт ошибку.
- `stage` у текстового входа — чей `prompt.md`. Для `from: prompt` это сам текст. Для `approve-meta` это запасной файл, если в ролике нет промпта (финал: `video_preview`).

### Пути внутри JSON-строки, константы

Некоторые ноды получают всё одним JSON в строковом поле (`MiniMaxH3Creator.creator_data`). Target и removal принимают `json` — путь через точку, номер элемента массива — числом:

```json
{ "targets": [{ "node": "1", "field": "creator_data", "json": "segments.0.refined.body" }],
  "value": { "input": "text", "section": "body", "required": true } }
{ "targets": [{ "node": "1", "field": "creator_data", "json": "segments.0.assets.3.filename" }],
  "value": { "input": "people", "index": 1 },
  "whenEmpty": { "remove": [{ "node": "1", "field": "creator_data", "json": "segments.0.assets.3" }] } }
{ "targets": [{ "node": "1", "field": "creator_data", "json": "short_edge" }], "value": { "const": 1152 } }
```

- Родитель пути обязан быть в графе (проверяется при загрузке).
- Удаление элемента массива вырезает его; элементы одного массива удаляются с конца, номера не сдвигаются.
- `const` — значение как есть: число, `true`/`false`, строка, объект.

### Ролики и длительность

- `kind: "video"` — как `image`, но файлы `mp4`, `webm`, `mov`, `mkv` (тот же `from`, `pick`, `uploadAs`). Загружаются в ComfyUI тем же `/upload/image`.
- Число `from: "media:duration"`, `of: "<вход video>"` — длительность ролика по атому `mvhd` (mp4/mov), округление до секунды, в пределах `min..max`.

### Язык текста

Текст для модели проверяется перед запуском: строка инструкции доски («Собери …», «Правила: playbooks/…») или строка с русским текстом (5+ кириллических букв, не считая имён персонажей кадра, дословных реплик из `shots/{shotId}/speech.md` и длительности «5 сек») — ошибка «перепиши prompt.md или отправь агенту». Старые `prompt.md` переводятся скриптом `npm run migrate-prompts` (без `--write` только показывает план).

## Метаданные

Манифест не добавляет нод сохранения метаданных.

- PNG: ComfyUI сам пишет граф в чанки `tEXt`/`iTXt` с ключом `prompt` (`src/components/stage/png-metadata.ts`).
- Ролик: файл пишет `SaveVideo`. Скрытые входы ноды — `prompt` (граф в формате API) и `extra_pnginfo`. В mp4/mov это ключи контейнера (`movflags=use_metadata_tags`: атомы `moov/udta/meta/keys` + `ilst`, значение `prompt` — JSON графа). `CreateVideo` только собирает кадры и файл не пишет. webm/mkv доска как источник промпта не читает. Разбор — `readVideoPromptText` в `src/lib/comfy/binding.ts`.

## Кто что делает

| Кто | Что |
|---|---|
| Модуль 3 (`src/lib/comfy/*`) | читает манифесты, проверяет их против графа при загрузке, собирает prompt, реализует `listWorkflowChoices`/`resolveWorkflowId` по манифестам |
| Модуль 4 (`playbooks/**`) | сопровождает графы и манифесты: пересохранил граф — обновил манифест в том же коммите, `npm test` зелёный; добавляет новые варианты |
| Модуль 6 (UI) | меню воркфлоу из `StageDetail.workflows`, выбор — `PATCH` с `runWorkflow` |

## Текущие манифесты

| id | Этап | Граф |
|---|---|---|
| `location_views` | location | `location_views_multiple_angles.json` |
| `location_krea2` | location | `location_krea2_api.json` |
| `location_firered` | location | `location_firered_edit.json` (FireRed-Image-Edit-1.1, 1–3 картинки из `refs/`) |
| `first_frame_compositing` | first_frame | `qwen21_character_compositing.json` |
| `video_i2v`, `video_flf` | video_preview | `wan22_i2v_sketch_turbo_api.json`, `wan22_flf_sketch_turbo_api.json`; длительность — `settings:seconds` → `prompt:seconds` → граф (нода `129:161`) |
| `video_ltx` | video_preview | `ltx25_i2v_api.json` (LTX 2.5 i2v, 24 к/с, со звуком); длительность — `settings:seconds` → `prompt:seconds` → граф (нода `398:362`), 2–10 с |
| `final_wan_720` | final_render | `wan22_i2v_sketch_turbo_api.json` (720×1280, 24 к/с; промпт — `approve-meta` эскиза, запасной `prompt.md`) |
| `final_ltx` | final_render | `ltx25_i2v_api.json` (нода `403`: 1.2 Мп, 9:16 → 832×1504, 24 к/с; `whenSketch` — эскиз LTX) |
| `final_h3`, `final_h3_768`, `final_h3_768_face` | final_render | `minimax_h3_creator_api.json` (MiniMax H3; исходный промпт — `approve-meta` эскиза) |
| `final_heygen` | final_render | `heygen_video_i2v_api.json` (Comfy Cloud; `defaultWhen: dialogue`; запуск только с галочкой на этот раз) |
| `final_i2v`, `final_flf` | final_render | те же графы, префикс `frameboard/final/` |

Составлены по `stage-run.ts` на момент контракта: собранный по ним prompt должен совпадать с текущим (кроме случайных seed).
