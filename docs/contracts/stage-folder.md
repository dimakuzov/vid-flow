# Контракт: папка этапа и статус

Папка: `data/episodes/{episodeId}/shots/{shotId}/{stage}/`.

## Файлы и кто их пишет

| Файл | Что это | Пишет | Агент |
|---|---|---|---|
| `refs/` | входные картинки этапа | пользователь, агент (если пересобирает референсы) | да, по правилам запроса |
| `output/` | результаты | очередь Comfy, агент (characters), загрузка | только добавлять |
| `approve/` | выбранный результат | кнопка approve, агент (characters) | только по плейбуку |
| `prompt.md` | **ровно текст, который уходит в модель**, на языке модели. Новые кадры получают пустой файл | пользователь, агент (или доска в text-режиме агента) | да |
| `run_settings.json` | выбор воркфлоу этапа `{ "workflow": "<id манифеста>" }` (`docs/contracts/graph-binding.md`) | доска (PATCH этапа, поле `runWorkflow`) | нет |
| `llm_notes.md` | поле ввода рекомендации на доске | пользователь; доска очищает при отправке | нет |
| `refs.md`, `workflow.md` | заметки | пользователь, агент | да |
| `status.json` | ожидаемые персонажи, заметка. Поле `status` информационное | доска | нет |
| `stage_state.json` | активная операция этапа (фаза) | **только доска** | нет |
| `agent_request.json/.md`, `llm_task.md` | запрос агенту (`docs/contracts/agent-request.md`) | доска; агент ставит `status: done` | только `status` (и `suggestedWorkflow`) |
| `agent_dispatch.json` | связь запроса и задания Comfy | доска | нет |
| `agent_baseline.json`, `agent_touch.json` | снимок refs для сравнения | агент / доска | да |
| `prompt_history.json` | прошлые версии `prompt.md` | доска | нет |
| `run_log.md` | журнал прогонов агента | агент | дописывать |

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
| `mutations.ts` | `saveUpload({episodeId,...})`, `approveFiles({episodeId,...})`, `updateStageDocs({episodeId,...})`, `removeApprovedFile(ep, shot, stage, name)`, `listApprove(ep, shot, stage)`, `deleteShot(ep, shot)` |
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
