# Контракт: папка этапа и статус

Папка: `data/episodes/{episodeId}/shots/{shotId}/{stage}/`.

## Файлы и кто их пишет

| Файл | Что это | Пишет | Агент |
|---|---|---|---|
| `refs/` | входные картинки этапа | пользователь (загрузка; убрать из графа — «Убрать», удалить — руками в папке), агент (если пересобирает референсы) | да, по правилам запроса; не удалять |
| `output/` | результаты | очередь Comfy, агент (characters), загрузка, обрезка и правка; удаляет только пользователь кнопкой | только добавлять |
| `output/edits.json` | связь нового файла с исходником: `{ file, from, kind: crop \| edit, prompt?, workflow?, at }` | доска (обрезка и правка) | нет |
| `approve/` | выбранный результат | кнопка approve, агент (characters) | только по плейбуку |
| `prompt.md` | **ровно текст, который уходит в модель**, на языке модели. Новые кадры получают пустой файл | пользователь, агент (или доска в text-режиме агента) | да |
| `run_settings.json` | выбор этапа: `{ "workflow": "<id манифеста>", "durationSec": 4, "excluded": ["<путь от data/>"] }` (`docs/contracts/graph-binding.md`) | доска (PATCH этапа, поля `runWorkflow`, `runDuration`, `exclude`) | нет |
| `../speech.md` (в папке **кадра**, `shots/{shotId}/speech.md`) | прямая речь кадра: что персонажи говорят вслух, дословно, одна реплика на строку (`Катя: Мама, я дома.`). Нет файла — молчат. Поле «Реплики» под промптом на этапах `video_preview` и `final_render`; в модель напрямую не идёт, агент получает его в задаче | пользователь (PATCH этапа или POST agent-request, поле `speech`; пусто — файл удаляется) | читать |
| `../agent.json` (в папке **кадра**) | агент кадра: `{ provider, model, updatedAt }` — им идут все запуски кадра (`docs/contracts/agent-request.md`, «Агент кадра») | **только доска** | нет |
| `llm_notes.md` | поле ввода рекомендации на доске | пользователь; доска очищает при отправке | нет |
| `refs.md`, `workflow.md` | заметки | пользователь, агент | да |
| `status.json` | ожидаемые персонажи, заметка. Поле `status` информационное | доска | нет |
| `stage_state.json` | активная операция этапа (фаза) | **только доска** | нет |
| `agent_request.json/.md`, `llm_task.md` | запрос агенту (`docs/contracts/agent-request.md`) | доска; агент ставит `status: done` | только `status` (и `suggestedWorkflow`) |
| `agent_dispatch.json` | связь запроса и задания Comfy | доска | нет |
| `agent_baseline.json`, `agent_touch.json` | снимок refs для сравнения | агент / доска | да |
| `prompt_history.json` | прошлые версии `prompt.md` | доска | нет |
| `run_log.md` | журнал прогонов агента | агент | дописывать |

## Правка картинки

Кнопка «Править» на картинке в `output/` и `approve/` (и в просмотре). Исходный файл не меняется и не удаляется.

- Обрезка считается в браузере. `POST .../crop` (форма: `file`, `source`, `folder`) кладёт новый PNG в `output/` как `{имя}_crop.png`. Совпадение имени — суффикс, как у загрузки.
- Правка и улучшение: `POST .../edit` с `{ filename, folder, workflow, text, megapixels? }`. Пустой `text` — готовый промпт: чуть лучше текстуры и мелкие детали, объекты, свет и камера как есть, Claude не вызывается. Непустой текст собирает Claude Haiku 5.5 без картинки, по `playbooks/models/image_edit.en.md`: сначала просьба, потом сохранение того, чего она не касается; камера не двигается. `megapixels` пишется в ноду 13; нет поля — в графе остаётся своё число. Задание — в очередь ComfyUI, ожидаемый файл `{имя}_edit_v1.png`. Воркфлоу лежат в `playbooks/workflows/comfy/edit/` и в меню этапа не входят. Файл графа не меняется.
- `GET .../edit` — список связей и воркфлоу правки. Если очередь сохранила файл под другим именем, связь обновляется на него.
- Референс из библиотеки, другого этапа или другого кадра: `GET/POST .../ref-sources`. Файл копируется в `refs/`, `agent_touch.json` помечает правку пользователя.

## Удаление файлов

Корзина на карточке файла в `output/` удаляет файл с диска насовсем (`fs.unlinkSync`, не в корзину Windows), после вопроса «Удалить файл … навсегда?». Это и есть подтверждение пользователя; агент сам из этих папок не удаляет. У `refs/` корзины на доске нет: там «Убрать из графа» (ниже), а удалить файл пользователь может руками в папке. Маршрут `DELETE .../files` по-прежнему принимает и `refs`.

- Только имя файла (`path.basename`, без `..` и `/`), только внутри папки этапа, только существующий файл.
- `refs/`: после удаления доска пишет `agent_touch.json` с `refsTouchedByUser: true` (как при загрузке) — агент тогда не пересобирает refs.
- Занятый этап (`agent`, `queued`, `running`): из `output/` удалять можно, из `refs/` нельзя (граф или агент могут их читать) — ошибка «Этап занят…».
- `output/` опустел, а `status.json` был `review` — доска пишет `prep`.
- `approve/` — не здесь: «Убрать» (`DELETE .../approve`).

## Убрать из графа (`run_settings.json`, `excluded`)

Любой вход этапа — `refs/`, approve других этапов, библиотека, лица — можно убрать из графа этого этапа, не удаляя файл, и вернуть той же кнопкой («Убрать» / «Вернуть» на карточке). Касается и файлов, которые пользователь добавил сам.

- `PATCH .../stages/{stage}` с `{ "exclude": { "path": "<MediaFile.relativePath>", "excluded": true | false } }` → `StageDetail`. Только у свободного этапа.
- Список хранится в `run_settings.json` → `excluded` (пути от `data/`: `episodes/ep2/shots/s01/first_frame/refs/x.png`, `characters/Lena/portret.png`). Только для этого этапа: на других этапах тот же файл остаётся входом.
- `resolveImageInput` пропускает убранные файлы. Источник, где остались только убранные, считается пустым — вход берёт следующий источник (`["refs", "approve:characters"]`: свои refs убраны → approve персонажей).
- Агент видит список в задаче («Убрано пользователем из графа» / «Removed from the graph by the user») и эти файлы не использует, не удаляет и не возвращает.
- `StageDetail.excluded` — список путей; `StageInput.excluded` — убранные файлы этого входа (на странице бледные, с «Вернуть»).

## Входы этапа (`StageDetail.inputs`)

`stageInputs(ep, shot, stage)` в `src/lib/series/stage-inputs.ts` — что граф возьмёт по умолчанию. Только чтение. На странице этапа — блок «Что уйдёт в граф» над «Референсы».

`StageInput = { label, source, files: MediaFile[], excluded: MediaFile[] }`.

- Этап с манифестами: входы `image`/`video` выбранного воркфлоу (`run_settings.json`, иначе по умолчанию). Для каждого — первый непустой источник, как при запуске (`resolveImageInput`). `source`: «approve этапа Локация», «refs/ этого этапа», «библиотека data/locations/cafe/». Все источники пусты — `files: []`, `source: "пусто: …"`.
- `characters` (манифестов нет): по персонажу кадра — `full_body.png`, `portrait.png`, `side.png` из `data/characters/{name}/` (имя папки без учёта регистра), плюс «Образцы одежды» из `refs/`.
- Убранные пользователем файлы — в `excluded`, не в `files` (см. «Убрать из графа»).
- Файлы библиотек отдаются через `/api/media/{characters,locations}/...`.

## Статус клетки

Активная операция (`stage_state.json`) перекрывает статус, выведенный из папок.

| Статус | Откуда | Значение |
|---|---|---|
| `agent` | `stage_state.phase = agent` | запрос отправлен, ждём `done` от агента |
| `queued` | `phase = comfy`, задание `pending` (или `running` без `promptId`) | задание в `data/comfy_queue`, ComfyUI его ещё не принял (в том числе выключен) |
| `running` | `phase = comfy`, задание `running` с `promptId` | ComfyUI генерирует |
| `error` | `phase = error` или задание `error` | текст в `stage_state.error` / `job.error` |
| `approved` | папка `approve/` (для characters — файл у каждого персонажа) | |
| `review` | есть файлы в `output/` | |
| `prep` | есть `prompt.md` / `workflow.md` | |
| `empty` | ничего нет | |

Пока статус `agent`, `queued` или `running`, этап занят: «Отправить агенту» и «Запустить» возвращают ошибку, поля промпта и рекомендации только для чтения. «Отменить» (`POST /api/shots/{shotId}/stages/{stage}/cancel`) помечает запрос `cancelled`, задание очереди `cancelled` (снимает его из ComfyUI, если уже ушло) и возвращает этап в `idle`. «Сбросить ошибку» — тот же маршрут.

## `stage_state.json`

```json
{
  "phase": "idle | agent | comfy | error",
  "since": "ISO",
  "requestId": "s01-location-...",
  "jobId": "s01-location-...",
  "agentRunsComfy": false,
  "error": "текст",
  "updatedAt": "ISO"
}
```

## Переходы

| Из | В | Кто | Когда |
|---|---|---|---|
| любая свободная | `agent` | `submitAgentRequest` | «Отправить агенту» |
| любая свободная | `comfy` | `queueStageRun` | «Запустить» |
| `agent` | `comfy` | фоновый цикл (`reconcileStage`, каждые 3 с) | агент поставил `done`, этап запускает доска |
| `agent` | `idle` | фоновый цикл | агент поставил `done`, Comfy гонял сам (characters) |
| `agent` | `error` | фоновый цикл | нет ответа дольше `FRAMEBOARD_AGENT_TIMEOUT_MIN` (по умолчанию 60) |
| `comfy` | `idle` | фоновый цикл | задание `done` (файлы в `output/` → статус `review`) |
| `comfy` | `error` | фоновый цикл | задание `error` или файл задания пропал |
| `error` | `idle` | approve, загрузка в output, «Сбросить ошибку» | |
| занятая | `idle` | «Отменить» | |

Чтение статуса (`readStageState`) ничего не пишет: фазу `queued/running/done` оно берёт из файла задания по `jobId`. Записывает переходы только фоновый цикл и API-маршруты.

Фоновый цикл (`reconcileAllStages`) обходит **все** эпизоды, а не только открытый.

## Эпизод — всегда явный параметр

`current_episode.txt` — только выбор по умолчанию для интерфейса (что показать на `/`). Ни одна функция `src/lib/**` не читает его сама, кроме `scanSeries()` без аргумента и `requireCurrentEpisodeId()` для маршрутов, где эпизод не передан.

Порядок аргументов везде: `episodeId, shotId, stageId, ...`. Функции с опциями-объектом получают поле `episodeId`.

| Модуль | Функции |
|---|---|
| `paths.ts` | `episodeRoot(ep)`, `shotsDir(ep)`, `shotDir(ep, shot)`, `stageDir(ep, shot, stage)`, `ensureStageDirs(ep, shot)`, `ensureEpisodeScaffold(ep)`, `listShotIds(ep)`, `agentInboxRelative(ep)`, `createEpisode(ep)` (не меняет открытый эпизод), `prepareDataRoot()` (при старте процесса), `isInside(root, target)` |
| `stage-state.ts` | `readStageStateFile`, `writeStageState`, `setIdle`, `setError`, `readStageState`, `assertStageFree` — все `(ep, shot, stage, ...)` |
| `status.ts` | `readStatusFile`, `writeStatusFile`, `deriveStageStatus(ep, shot, stage, chars)`, `charactersApproved`, `locationApproved` |
| `shot-meta.ts` | `readShotMeta(ep, shot)`, `writeShotMeta(ep, meta)` |
| `shot-watch.ts` | `readShotWatch(ep, shot)`, `setShotWatchStopped(ep, shot, stopped)` |
| `prompt-history.ts` | `syncPromptHistory(ep, shot, stage)`, `restorePromptVersion(ep, shot, stage, id)` |
| `mutations.ts` | `saveUpload({episodeId,...})`, `approveFiles({episodeId,...})`, `updateStageDocs({episodeId,...})`, `removeApprovedFile(ep, shot, stage, name)`, `deleteStageFile(ep, shot, stage, folder, name)`, `listApprove(ep, shot, stage)`, `deleteShot(ep, shot)` |
| `scanner.ts` | `scanSeries(ep?)` (без аргумента — открытый эпизод), `getStageDetail(ep, shot, stage)` |
| `bootstrap.ts` | `applyBootstrap({episodeId,...})` (обязателен), `readScenarioText(ep)`, `readRawScenarioText(ep)` |
| `agent-request.ts` | `submitAgentRequest({episodeId,...})`, `readAgentRequest`, `readAgentRequestSummary`, `readAgentDispatch`, `writeAgentDispatch`, `stageBoardQueues`, `cancelAgentRequest` — `(ep, shot, stage)`; `rebuildAgentInbox(ep)`. В `agent_request.json` есть поле `episodeId` |
| `agent-dispatch.ts` | `reconcileStage(ep, shot, stage)`, `reconcileAllStages()`, `cancelStage(ep, shot, stage)` |
| `comfy/stage-run.ts` | `queueStageRun(ep, shot, stage, options)`. Задание очереди хранит `episodeId`, `shotId`, `stageId` |
| `route-params.ts` | `parseStageParams`, `parseShotParams` — проверка параметров пути в маршрутах |

`SERIES_ROOT` по-прежнему подменяет папку единственного эпизода: `listEpisodeIds()` возвращает его имя, `episodeRoot()` — этот путь.

Чтение без записей: `scanSeries()` ничего не пишет. Миграция старой раскладки `data/series/` и создание общих папок — `prepareDataRoot()` в `src/instrumentation.ts` и в скриптах. Исключение — `getStageDetail()`: синхронизирует `prompt_history.json`, чтобы поймать правку `prompt.md` агентом.

## API

Всё, что относится к кадру, — под эпизодом:

| Метод и путь | Что делает | Функция |
|---|---|---|
| `GET /api/episodes/{ep}` | сводка эпизода для таблицы | `scanSeries(ep)` |
| `DELETE /api/episodes/{ep}/shots/{shot}` | убрать кадр | `deleteShot` |
| `POST /api/episodes/{ep}/shots/{shot}/watch` | «Закончить кадр» | `setShotWatchStopped` |
| `GET, PATCH /api/episodes/{ep}/shots/{shot}/stages/{stage}` | этап: чтение, сохранение документов | `getStageDetail`, `updateStageDocs` |
| `POST .../stages/{stage}/upload` | загрузка в `refs/` или `output/` | `saveUpload` |
| `POST, DELETE .../stages/{stage}/approve` | утвердить / убрать из `approve/` | `approveFiles`, `removeApprovedFile` |
| `DELETE .../stages/{stage}/files` `{folder: "output" \| "refs", filename}` | удалить файл насовсем, ответ — `StageDetail` | `deleteStageFile` |
| `POST .../stages/{stage}/prompt-history` | вернуть версию промпта | `restorePromptVersion` |
| `POST .../stages/{stage}/agent-request` | отправить агенту | `submitAgentRequest` |
| `POST .../stages/{stage}/run` | поставить прогон в очередь | `queueStageRun` |
| `POST .../stages/{stage}/cancel` | отменить / сбросить ошибку | `cancelStage` |

Уровень сериала:

| Метод и путь | Что делает |
|---|---|
| `GET /api/series` | сводка открытого эпизода (`current_episode.txt`) |
| `POST /api/series/episode` `{episodeId}` | создать эпизод и сделать его открытым |
| `GET /api/series/bootstrap?episodeId=` · `POST` `{episodeId, ...}` | сценарий эпизода, создание кадров. Без `episodeId` — открытый эпизод |
| `POST /api/series/format-request` `{episodeId, rawText}` | сырой сценарий на разметку |
| `GET /api/media/episodes/{ep}/...` | файлы эпизода (только чтение) |
| `GET /api/media/{characters,locations,references}/...` | общие библиотеки (только чтение) |
| `GET, POST /api/comfy/queue` | задания очереди (`docs/contracts/comfy-job.md`) |

`/api/media` отдаёт только файлы внутри этих папок; `..`, `comfy_queue/`, `current_episode.txt` и соседний эпизод с общим префиксом (`e010` при `e01`) — 403. `MediaFile.relativePath` теперь от `data/`: `episodes/e01/shots/s01/location/output/x.png`.
