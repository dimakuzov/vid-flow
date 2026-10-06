# Контракт: запрос агенту и провайдер

Типы: `src/lib/contracts/agent-request.ts` (`AgentRequestFile`, `AgentProvider`, `AgentTask`, `AgentResult`, `AgentProviderInfo`). Владелец кода — модуль 5.

## Решения пользователя (не пересматривать)

- Статус этапа пишет только доска. Агент сигналит только `"status": "done"` в `agent_request.json`.
- В модель идёт только `prompt.md`. Рекомендация (`llm_notes.md`) очищается доской при отправке.
- Агента вызывает сама доска через провайдера: Ollama (HTTP) или `claude -p` по подписке пользователя. Ручной режим (агент в отдельном чате читает файлы) — запасной.

## Файлы запроса в папке этапа

| Файл | Что | Пишет |
|---|---|---|
| `agent_request.json` | состояние запроса (`AgentRequestFile`) | доска; ручной агент — только `status: done` и, по желанию, `suggestedWorkflow` |
| `llm_task.md` | **единственный** текст задачи, самодостаточный | доска при отправке |
| `agent_dispatch.json` | связь запроса и прогона: `workflow` (id манифеста), `jobId` | доска |
| `agent_baseline.json`, `agent_touch.json` | снимок refs для сравнения | доска после text-режима; агент в agent/manual |
| `run_log.md` | журнал: вывод CLI-агента, заметки | доска (agent), агент (дописывает) |

`agent_request.md` — устаревшая копия задачи; модуль 5 может убрать её, оставив `llm_task.md`. `agent_inbox.md` эпизода — только оглавление `pending`-запросов для ручного режима.

## Жизненный цикл

```
«Отправить агенту» ──> pending ──провайдер text/agent──> running ──> done | error
                          │                                  │
                          │ manual: агент сам ставит done ───┘
                          └──────────── «Отменить» ─────────────> cancelled
```

| status | Кто ставит | Поля |
|---|---|---|
| `pending` | `submitAgentRequest` | `createdAt`, `provider`, `mode`, `message` |
| `running` | исполнитель доски | `startedAt` |
| `done` | исполнитель доски (text/agent) или агент (manual) | `finishedAt` (доска), `suggestedWorkflow` |
| `error` | исполнитель доски / фоновый цикл (таймаут, перезапуск) | `error`, `finishedAt` |
| `cancelled` | `cancelStage` | `finishedAt` |

Фаза этапа (`stage_state.json`, `docs/contracts/stage-folder.md`) всё это время — `agent`. Фоновый цикл (`reconcileStage`) переводит её:

- запрос `done` → `comfy` (доска ставит прогон с `agent_dispatch.workflow`, иначе выбором этапа) или `idle` (агент сам гонял ComfyUI — `agentRunsComfy`);
- запрос `error` → фаза `error` с текстом `request.error`;
- запрос `cancelled` → `idle`;
- `running`, а процесса в этой доске нет (сервер перезапущен) → `error` «доска перезапущена, пока работал агент»;
- нет ответа дольше таймаута режима → `error`.

## Режимы и провайдеры

| Режим | Когда | Что делает доска |
|---|---|---|
| `text` | у этапа есть доступный воркфлоу доски (`listWorkflowChoices` → `available`): location, first_frame, video | собирает `AgentTask.system` (плейбук модели выбранного воркфлоу, поле `playbook` манифеста, плюс правило «верни только текст промпта») и `user` (сообщение, текущий `prompt.md`, действие кадра из `shot.md`, имена файлов в `refs/`, персонажи). Один запрос к LLM. Ответ без обрамления ``` пишет в `prompt.md` через `updateStageDocs` (история промпта), обновляет `agent_baseline.json`, ставит `done` |
| `agent` | у этапа нет воркфлоу доски (`characters`) или пользователь выбрал | запускает CLI-агента в корне репо с `llm_task.md`, вывод пишет в `run_log.md`, по выходу процесса: 0 → `done`, иначе `error` |
| `manual` | провайдер `manual` | ничего не запускает; запрос ждёт `done` от агента в чате |

| Провайдер | Режимы | Вызов |
|---|---|---|
| `manual` | manual | — |
| `ollama` | text | `POST {FRAMEBOARD_OLLAMA_URL}/api/chat`, `stream: false`, модель `FRAMEBOARD_OLLAMA_MODEL` |
| `claude` | text, agent | text: `claude -p --output-format json` (текст на stdin, ответ в `.result`). agent: `claude -p <задача> --output-format stream-json --verbose --allowedTools ...` в корне репо. Подписка пользователя, без API-ключа |

Провайдер не умеет нужный режим (например, `ollama` на `characters`) — запрос сразу `error` с понятным текстом; интерфейс такой выбор не предлагает.

## Настройка

| Переменная | По умолчанию | Что |
|---|---|---|
| `FRAMEBOARD_AGENT_PROVIDER` | `manual` | провайдер по умолчанию |
| `FRAMEBOARD_OLLAMA_URL` | `http://127.0.0.1:11434` | |
| `FRAMEBOARD_OLLAMA_MODEL` | — | без неё `ollama` недоступен |
| `FRAMEBOARD_CLAUDE_BIN` | `claude` | путь к CLI |
| `FRAMEBOARD_AGENT_TEXT_TIMEOUT_MIN` | 5 | таймаут text |
| `FRAMEBOARD_AGENT_RUN_TIMEOUT_MIN` | 30 | таймаут agent |
| `FRAMEBOARD_AGENT_TIMEOUT_MIN` | 60 | таймаут manual (уже есть, бриф 1) |

## Отмена

Исполнитель держит `AbortController` на запрос (по `request.id`) в памяти процесса. `cancelStage` помечает запрос `cancelled` и вызывает abort: HTTP-запрос к Ollama обрывается, процесс `claude` убивается вместе с дочерними. Результат, пришедший после отмены, не пишется.

## API

| Метод и путь | Тело / ответ |
|---|---|
| `POST /api/episodes/{ep}/shots/{shot}/stages/{stage}/agent-request` | `{ message, prompt, refs, workflow, runWorkflow?, provider? }` (`workflow` — заметка `workflow.md`; `runWorkflow` — id манифеста; `videoWorkflow` — старое имя). Ответ `{ message, refsChangedByUser, stage: StageDetail }` |
| `POST .../stages/{stage}/cancel` | отмена (общая с прогоном) |
| `GET /api/agent/providers` | `AgentProviderInfo[]`: `id`, `label`, `modes`, `available`, `reason`, `isDefault` |

`StageDetail.agentRequest` отдаёт `status`, `provider`, `error`, `suggestedWorkflow` (поля уже в `types.ts`).

## Ручной режим и `agent-mail/`

Ручной режим остаётся: `AGENTS.md` коротко говорит, где взять задачу (`agent_inbox.md` → `llm_task.md`) и что единственный сигнал — `done`. `agent-mail/` (связь облако ↔ локальная машина через git) к доске не относится; модуль 5 решает, оставить ли его ручным инструментом, и записывает решение в `AGENTS.md`.
