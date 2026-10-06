# Контракт: папка этапа и статус

Папка: `data/episodes/{episodeId}/shots/{shotId}/{stage}/`.

## Файлы и кто их пишет

| Файл | Что это | Пишет | Агент |
|---|---|---|---|
| `refs/` | входные картинки этапа | пользователь, агент (если пересобирает референсы) | да, по правилам запроса |
| `output/` | результаты | очередь Comfy, агент (characters), загрузка | только добавлять |
| `approve/` | выбранный результат | кнопка approve, агент (characters) | только по плейбуку |
| `prompt.md` | **ровно текст, который уходит в модель** | пользователь, агент | да |
| `llm_notes.md` | поле ввода рекомендации на доске | пользователь; доска очищает при отправке | нет |
| `refs.md`, `workflow.md` | заметки | пользователь, агент | да |
| `status.json` | ожидаемые персонажи, заметка. Поле `status` информационное | доска | нет |
| `stage_state.json` | активная операция этапа (фаза) | **только доска** | нет |
| `agent_request.json/.md`, `llm_task.md` | запрос агенту | доска; агент ставит `status: done` | только `status` |
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

Ограничение: фоновый цикл обходит только открытый эпизод (`current_episode.txt`). Явный `episodeId` — бриф 2.
