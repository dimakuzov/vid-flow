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
| `run_log.md` | журнал: после каждого прогона доски — блок `## время · провайдер · модель · режим · статус` с расходом (`AgentResult.usage`: токены вход / запись в кэш / из кэша / выход, стоимость по ценам API, время всего и ответа модели, ходы); в агентном режиме ниже — вывод CLI-агента. Агент дописывает свои заметки. Тот же расход — в `agent_request.json`, поле `usage` | доска, агент (дописывает) |

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
| `claude` | text, agent | `claudeInvocation` в `providers.ts`. Оба режима стартуют в пустой папке вне репозитория (`%TEMP%/frameboard-claude`: без `CLAUDE.md`, `AGENTS.md`, памяти проекта), с `--strict-mcp-config` (без MCP-серверов) и `--no-session-persistence`. text: `--tools ""` (без инструментов), `--system-prompt` = правила и плейбук этапа, задача на stdin, ответ в `.result` — один запрос, один ответ. agent: `--restricted` (без настроек, файловые инструменты только в `--add-dir`), `--tools`/`--allowedTools Read,Write,Edit,Glob,Grep,Bash`, `--add-dir`: папка кадра, `playbooks/`, `data/comfy_queue/`, `docs/contracts/`, библиотека этапа (`data/characters/` или `data/locations/`); `--append-system-prompt` — рамки «один этап одного кадра». Ошибка — поле `result` ответа. Подписка пользователя, без API-ключа |

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
| `POST /api/episodes/{ep}/shots/{shot}/stages/{stage}/agent-request` | `{ message, prompt, refs, workflow, runWorkflow?, provider?, model?, rememberForShot?, allowCloud?, takes? }` (`workflow` — заметка `workflow.md`; `runWorkflow` — id манифеста; `videoWorkflow` — старое имя; `rememberForShot: true` — после принятого запроса записать `provider`/`model` агентом кадра; `allowCloud: true` — галочка платной отправки: доска запустит облачный воркфлоу после ответа агента, один раз; `takes` — 1–8 файлов с тем же промптом и разными seed, нет — 1, финал всегда 1, между заходами не запоминается; хранится в `agent_dispatch.json`). Ответ `{ message, refsChangedByUser, stage: StageDetail }` |
| `POST .../stages/{stage}/cancel` | отмена (общая с прогоном) |
| `GET /api/episodes/{ep}/shots/{shot}/agent` | `{ agent: ShotAgent \| null, activity }` — агент кадра и что он делает |
| `PUT /api/episodes/{ep}/shots/{shot}/agent` | `{ provider, model? }` — «Сохранить» в меню агента кадра. Неизвестный провайдер или модель — 400 |
| `POST /api/episodes/{ep}/shots/{shot}/next-stage` | `{ provider?, model? }` — следующий неутверждённый этап агентом кадра. Кнопки на столбце «Кадр» больше нет. Ответ `{ started, skipped, assigned }` |
| `POST /api/episodes/{ep}/assign-agents` | `{ provider, model? }` — агент кадрам без агента, ничего не запускает. Кнопки на столбце «Кадр» больше нет. Ответ `{ started: [], skipped: [], assigned }` |
| `POST /api/episodes/{ep}/stages/{stage}/run-all` | `{ provider?, model?, redo? }` — агент для кадров **без своего агента**, назначается им; кадры с агентом идут своим. Ответ `{ started, skipped, assigned }` |
| `GET /api/agent/providers` | `AgentProviderInfo[]`: `id`, `label`, `modes`, `available`, `reason`, `isDefault` |
| `GET /api/agent/runs` | `{ running, queued }` по всем эпизодам — см. «Агенты доски в CLI» |
| `POST /api/agent/runs/stop` | `{ episodeId, shotId, stageId }`, `{ episodeId, shotId }` (все этапы кадра), `{ episodeId, format: true }` или `{ all: true }`. Ответ `{ stopped, running, queued }` |

`StageDetail.agentRequest` отдаёт `status`, `provider`, `error`, `suggestedWorkflow` (поля уже в `types.ts`). `StageDetail.shotAgent` — агент кадра.

## Агент кадра

`shots/{shotId}/agent.json` → `{ provider, model, updatedAt }` (`model: null` — модель провайдера по умолчанию). Пишет **только доска** (`writeShotAgent` в `src/lib/series/shot-agent.ts`; провайдер и модель проверяются как в запросе). Агент файл не трогает.

- Сам агент ничего не начинает. Этап запускают «Отправить агенту» на странице этапа и «▶ Все кадры» над столбцом этапа. Оба идут агентом кадра. У кадра без агента — агент, выбранный в меню; он назначается кадру. Выбора нет — `FRAMEBOARD_AGENT_PROVIDER` (иначе manual), без назначения. Столбец «Кадр» этап не запускает.
- «▶ Все кадры» над столбцом этапа назначает выбор **всем кадрам без агента** (и тем, что будут пропущены), кадры с агентом не меняет. Меню спрашивает агента, только если такие кадры есть.
- Страница этапа: «Отправить агенту» по умолчанию берёт агента кадра; другой выбор уходит на один запуск, с галкой «запомнить» — становится агентом кадра. У кадра без агента галка включена.
- `agent_request.json` хранит, кем фактически выполнен запуск (`provider`, `model`).
- `ShotSummary.agent` — `{ provider, model } | null`; `ShotSummary.agentActivity` — `{ stageId, status: running | queued, since, provider } | null`: работающий запрос этапов кадра, иначе ждущий (`pending`, этап в фазе `agent` с этим запросом, включая manual — «ждёт агента в чате»).

## Агенты доски в CLI

`GET /api/agent/runs` (`listAgentRuns` в `src/lib/series/agent-dispatch.ts`) — что сейчас делают провайдеры доски. Элемент списка (`AgentRunEntry`): `kind` (`stage` или `format` — разметка сценария), `episodeId`, `shotId`, `stageId` (у `format` — `null`), `provider`, `model` (без выбора — модель провайдера по умолчанию), `since`.

- `running` — живые прогоны этого процесса доски: исполнитель (`listLiveAgentRuns` в `runner.ts`, без отменённых) и разметка (`isFormatRunLive`). `since` — `startedAt`.
- `queued` — `pending` у `ollama` / `claude`, которые фоновый цикл запустит, когда у провайдера освободится место (`providerParallel`): этап в фазе `agent` с этим же запросом, плюс разметка `pending`. `since` — `createdAt`.
- `manual` в список не входит: его исполняет агент в чате, а не доска.

`POST /api/agent/runs/stop` (`stopAgentRuns`): тело `{ episodeId, shotId, stageId }`, `{ episodeId, format: true }` или `{ all: true }`. Для этапа вызывает `cancelStage` — ровно то же, что «Отменить» на этапе. Для разметки сценария — `abortFormatRun` (`src/lib/agent/format-runner.ts`): живой прогон получает abort, ждущий больше не запустится, `format_request.json` становится `error` с текстом «Разметка остановлена», ответ модели, пришедший после остановки, не применяется. `{ all: true }` останавливает все записи из обоих списков. Цель без прогона агента доски не трогается (`stopped: []`). CLI: `npm run agents -- stop e01/format`.

Скрипты без зависимостей: `scripts/frameboard-status.mjs` — строка состояния Claude Code (таймаут 500 мс, код выхода всегда 0), `scripts/frameboard-agents.mjs` — `npm run agents -- list | stop <ep>/<shot>/<stage> | stop --all`. Порт — `FRAMEBOARD_PORT` (3456). Настройка — README, «Агенты доски в Claude Code».

## Что агент знает о кадре: замечания, картинки, действие

Код: `src/lib/series/shot-notes.ts`, `descriptions.ts`, `shot-action.ts`, текст для агента — `src/lib/agent/shot-context.ts`. Все файлы пишет только доска.

| Файл | Что | Когда |
|---|---|---|
| `shots/{shotId}/notes.json` | замечания пользователя ко всем этапам кадра: `{ entries: [{ id, at, stageId, message }] }` | `submitAgentRequest`, если сообщение написал пользователь (у массового запуска `auto: true` — не пишется). Убрать — `DELETE /api/episodes/{ep}/shots/{shot}/notes` `{ id }` |
| `data/descriptions/{sha256}.json` | что на утверждённой картинке на самом деле: `{ sha256, kind: location \| character \| first_frame, text, model, createdAt, source }` | фоновый цикл `image-descriptions` (20 с, текущий эпизод, не больше 2 сразу) и перед задачей агенту. Ключ — содержимое файла: один файл в нескольких кадрах описывается один раз, замена файла в approve — новое описание |
| `shots/{shotId}/action.md`, `action.json` | действие кадра под утверждённые картинки, по-русски; `action.json` — `{ basis, textSha, source: agent \| user, at, model? }` | перед задачей агенту на `first_frame`, `video_preview`, `final_render`, если изменилась основа (shot.md, картинки и их описания, замечания). Правка на странице — `PUT /api/episodes/{ep}/shots/{shot}/action` `{ text }`: версия пользователя, она важнее модели и уходит в следующую пересборку как замечание; пустой текст — убрать |

Описание локации называет число пространств, их примерный размер, передний, средний и задний план, проёмы и препятствия, где можно стоять и как далеко будут люди, и свет. Описание первого кадра добавляет число людей, позу, видно ли лицо и примерную долю площади лица и тела, и те же факты о месте. Описания и действие делает `claude -p` (`src/lib/agent/claude-oneshot.ts`): описания — `FRAMEBOARD_VISION_MODEL` (по умолчанию `claude-haiku-5-5`: только «что на картинке»), действие — `FRAMEBOARD_CONTEXT_MODEL` (по умолчанию `claude-sonnet-5-5`); пустая временная папка, картинка копируется туда и открывается инструментом Read. `FRAMEBOARD_DESCRIBE=off` выключает и то и другое; при `FRAMEBOARD_LOOPS=off` (тесты, скрипты) настоящий claude здесь не вызывается. Не вышло — агент работает с тем, что есть.

В задаче агента (text и `llm_task.md`) после shot.md: действие по картинкам, описания картинок (на первом кадре — без его прошлого утверждённого варианта), прошлые замечания кадра (текущее сообщение — только как запрос) и порядок приоритета: запрос → прошлые замечания (позднее важнее) → что на картинках → действие по картинкам → shot.md → остальное.

## Видео: какой воркфлоу

Таблица «когда какой вариант» лежит в плейбуке этапа (`playbooks/stages/video_preview.en.md`, `final_render.en.md`, и в `.en.md`) и повторена в плейбуке модели, который text-режим уже кладёт в системный промпт. Агент, если выбранный вариант не из таблицы, пишет его id в `suggestedWorkflow`. Доска показывает предложение и сама не переключает.

Пометка, что промпт финала взят из `prompt.md` эскиза, а не из метаданных ролика: `sketchPromptTaskNote` (`src/lib/comfy/binding.ts`). `buildPrompt` дописывает её в `run_log.md` этапа в момент запуска. В текст задачи (text и `llm_task.md`) её ещё нужно вставить сборщику задачи — файл `src/lib/series/agent-request.ts` и `src/lib/agent/task.ts` в этом раунде не правятся.

## Модель этапа

`STAGE_CLAUDE_MODELS` в `src/lib/agent/config.ts`: у Claude по умолчанию Haiku 5.5, на `first_frame` — Sonnet, даже если кадру назначен другой. Массовый запуск берёт её (`stageModel`), страница этапа предлагает её по умолчанию (`AgentProviderInfo.stageModels`); другая модель, выбранная в меню, уходит на один запуск. Разметка сырого сценария в таблицу по умолчанию — Opus 5.5 (`FORMAT_CLAUDE_MODEL`). Описания картинок по-прежнему пишет Haiku (`FRAMEBOARD_VISION_MODEL`).

## Правила `prompt.md` на первых кадре, превью и финале

Код: `GENERATION_PROMPT_RULES` в `src/lib/agent/task.ts` (text-режим, в system перед плейбуком) и `renderPromptRules` в `src/lib/series/agent-request.ts` (тот же текст по-русски в `llm_task.md`). Одни для всех воркфлоу этих трёх этапов и важнее плейбука модели.

`prompt.md` на английском, без кириллицы; реплику на русский не переводить. Перед каждым новым проходом агента реплики сверяются заново с `speech.md` этого запроса: в промпте не остаются строки из прошлого `prompt.md`, если реплики изменились. Люди — `character1`, `character2`, `character3` в порядке референсов (список «Images the graph receives», иначе алфавит имён из строки персонажей). Имена из сообщения и shot.md в промпт не попадают: ими пользователь говорит с агентом. Каждого — одно-два предложения, и привязка к картинкам (`character1 is image 2 and the face from image 4`). Промпт — вся инструкция этого запуска: просьбу «всё хорошо, добавь пакет» агент вписывает в полный прошлый текст, а не заменяет его на «сделай как раньше». Сравнение с прошлым кадром (`than before`, `much closer`, `as before`) доска не отправляет: «ещё ближе» переписывается абсолютным крупным планом.

## Ручной режим и `agent-mail/`

Ручной режим остаётся: `AGENTS.md` коротко говорит, где взять задачу (`agent_inbox.md` → `llm_task.md`) и что единственный сигнал — `done`. `agent-mail/` (связь облако ↔ локальная машина через git) к доске не относится; модуль 5 решает, оставить ли его ручным инструментом, и записывает решение в `AGENTS.md`.
