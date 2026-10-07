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
- **По умолчанию** — первый по `order` доступный вариант; если доступных нет — первый по `order`.
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
"seconds":  { "kind": "number", "from": "settings:seconds", "fallback": "prompt:seconds", "min": 2, "max": 8, "label": "Длительность клипа" }
```

Картинки (`kind: image`):

| `from` | Откуда |
|---|---|
| `refs` | `refs/` этого этапа |
| `approve:<stage>` | `approve/` другого этапа этого кадра |
| `library:location` | `data/locations/<location из shot.md>/`: `view.png`, иначе первая картинка без `copy` в имени |
| массив | источники по порядку, берётся первый непустой |

`pick`: `first` — первая по имени (числа по значению), `newest` — самая новая по mtime, `all` — все по имени, не больше `max`. `min` (по умолчанию 1) — сколько нужно для `available`; `min: 0` — вход необязательный. `uploadAs` — имя файла при загрузке в ComfyUI: `{shotId}`, `{episodeId}`, `{index}`, `{ext}` (расширение с точкой, в нижнем регистре, по умолчанию `.png`); без него — имя файла.

Текст (`kind: text`): только `prompt.md` этапа, `trim()`, **без фильтров**. `required: true` — пустой `prompt.md` даёт ошибку при запуске. На `available` текст и число не влияют: промпт часто пишет агент уже после выбора варианта.

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
- `stage` у текстового входа — взять `prompt.md` другого этапа (финал берёт исходный Wan-промпт у `video_preview`).

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

Текст для модели проверяется перед запуском: строка инструкции доски («Собери …», «Правила: playbooks/…») или строка с русским текстом (5+ кириллических букв, не считая имён персонажей кадра и длительности «5 сек») — ошибка «перепиши prompt.md или отправь агенту». Старые `prompt.md` переводятся скриптом `npm run migrate-prompts` (без `--write` только показывает план).

## Метаданные

Манифест не добавляет нод сохранения метаданных: ComfyUI сам пишет воркфлоу в PNG. Для видео нода сохранения должна писать метаданные (проверяет бриф 4).

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
| `first_frame_compositing` | first_frame | `qwen21_character_compositing.json` |
| `video_i2v`, `video_flf` | video_preview | `wan22_i2v_sketch_turbo_api.json`, `wan22_flf_sketch_turbo_api.json`; длительность — `settings:seconds` → `prompt:seconds` → граф (нода `129:161`) |
| `final_h3`, `final_h3_768` | final_render | `minimax_h3_creator_api.json` (MiniMax H3) |
| `final_i2v`, `final_flf` | final_render | те же графы, префикс `frameboard/final/` |

Составлены по `stage-run.ts` на момент контракта: собранный по ним prompt должен совпадать с текущим (кроме случайных seed).
