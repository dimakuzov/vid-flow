# Frameboard: карта модулей и общие правила

Читать каждому агенту перед своим брифом. Папку `data/` не просматривать: это реальный проект пользователя. Работать только с временной `DATA_ROOT` (см. ниже).

## Как устроен поток

```
UI (Next.js) ──HTTP──> API /api/episodes/{ep}/shots/{shot}/stages/{stage}/...  ──> lib/series (файлы = источник правды)
                                                       │
     «Отправить агенту» ──> agent_request.json, llm_task.md ──> провайдер агента (модуль 5): Ollama / claude -p / вручную
                                                       │                     │ status: done
     фоновый цикл agent-dispatch (3 с, все эпизоды) <──┘─────────────────────┘
                     │ queueStageRun(ep, shot, stage, { workflow })
                     ↓
     lib/comfy: граф + манифест *.bind.json ──> data/comfy_queue/<id>.json ──> очередь (2 с) ──> ComfyUI :8188 ──> output/
```

Фоновые циклы живут в процессе Next: `src/instrumentation.ts` → `src/lib/background.ts` (`registerLoop`, переживает горячую перезагрузку). Отдельного воркера нет.

## Состояние работ

| # | Модуль | Статус |
|---|---|---|
| 1 | Единое состояние этапа | готово, ветка `stage-state`, отчёт `reports/01-stage-state.md` |
| 2 | Хранилище, явный `episodeId` | готово, ветка `storage`, отчёт `reports/02-storage.md` |
| — | Контракты для параллельной работы | готово, ветка `contracts` (содержит 1 и 2) |
| 3 | Запуск в ComfyUI | бриф `03-comfy-runner.md` |
| 4 | Воркфлоу и плейбуки | бриф `04-workflows.md` |
| 5 | Связь с агентом | бриф `05-agent-bridge.md` |
| 6 | Интерфейс | бриф `06-ui.md` |

Брифы 3–6 делаются **параллельно**, каждый в своём git worktree от ветки `contracts`. Файлы между ними не пересекаются.

## Кто какие файлы правит

Правишь только файлы своей строки. Новые файлы создаёшь только в своих папках. Отчёт — `docs/briefs/reports/0N-<модуль>.md`.

| Бриф | Файлы |
|---|---|
| 3 | `src/lib/comfy/**`, `src/app/api/comfy/**`, `src/app/api/episodes/[episodeId]/shots/[shotId]/stages/[stage]/run/route.ts`, `scripts/comfy-queue.ts`, `package.json` (только раздел `scripts`, если нужно) |
| 4 | `playbooks/**` (плейбуки, графы, манифесты `*.bind.json`) |
| 5 | `src/lib/series/{agent-request,agent-dispatch,format-request}.ts`, `src/lib/series/stage-state.test.ts`, новая папка `src/lib/agent/**`, `src/app/api/episodes/[episodeId]/shots/[shotId]/stages/[stage]/{agent-request,cancel}/route.ts`, `src/app/api/series/format-request/route.ts`, новая папка `src/app/api/agent/**`, `AGENTS.md`, `CLAUDE.md`, `docs/AGENT_BOOTSTRAP.md`, `agent-mail/**` |
| 6 | `src/components/**`, `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/shots/**`, новая папка `src/app/e/**`, `src/lib/series/labels.ts`, `README.md` |

**Заморожено на время параллельной работы** (никто из 3–6 не правит; нужна правка — опиши в отчёте, раздел «Нужно от других модулей»):

- `src/lib/contracts/**` — типы контрактов и проверка манифестов (`graph-binding.test.ts`);
- `src/lib/series/{paths,status,media,mutations,scanner,prompt-history,shot-meta,shot-watch,bootstrap,types,constants,stage-state,run-settings,route-params}.ts`, `src/lib/series/storage.test.ts`;
- `src/lib/background.ts`, `src/instrumentation.ts`;
- остальные маршруты: `src/app/api/episodes/[episodeId]/route.ts`, `.../shots/[shotId]/{route,watch/route}.ts`, `.../stages/[stage]/{route,approve,upload,prompt-history}/route.ts`, `src/app/api/series/{route,episode,bootstrap}/**`, `src/app/api/media/**`;
- `docs/contracts/**`, `docs/briefs/0*.md`, `package-lock.json`, `scripts/bootstrap-sample.ts`.

API routes — тонкие обёртки над функцией модуля; route правит тот модуль, кому он отдан в таблице.

## Контракты

| Контракт | Документ | Типы |
|---|---|---|
| Папка этапа, фазы, эпизод в сигнатурах, API | `docs/contracts/stage-folder.md` | `src/lib/series/types.ts`, `stage-state.ts` |
| Манифест графа, несколько воркфлоу на этап | `docs/contracts/graph-binding.md` | `src/lib/contracts/graph-binding.ts` |
| Задание очереди ComfyUI | `docs/contracts/comfy-job.md` | `src/lib/contracts/comfy-job.ts` |
| Запрос агенту и провайдер | `docs/contracts/agent-request.md` | `src/lib/contracts/agent-request.ts` |

Зафиксированные сигнатуры между модулями (тело можно менять, сигнатуру — нет):

- модуль 3: `queueStageRun(episodeId, shotId, stageId, { workflow?, fromAgent? })`, `cancelComfyJob(id)`, `listWorkflowChoices(episodeId, shotId, stageId): WorkflowChoice[]`, `resolveWorkflowId(episodeId, shotId, stageId, requested)`, `startComfyQueue()`, `enqueueComfyJob(job)`, `readComfyJob(id)`;
- модуль 5: `submitAgentRequest({ episodeId, ... })`, `cancelStage(episodeId, shotId, stageId)`, `reconcileStage(...)`, `reconcileAllStages()`, `startAgentDispatch()`, `readAgentRequestSummary(...)`, `rebuildAgentInbox(episodeId)`.

Поля, которые нужны интерфейсу, уже есть в `StageDetail`: `workflow`, `workflows`, `job`, `agentRequest.{provider,error,suggestedWorkflow}`. Пока модули 3 и 5 не смержены, они заполняются временными значениями.

## Общие правила

- `data/` не открывать, не коммитить, ничего в нём не удалять. Тестовые данные — только во временной `DATA_ROOT`.
- Реальные задания в ComfyUI не отправлять: `COMFY_URL=http://127.0.0.1:9` (мёртвый порт). Задание должно висеть в «Ожидает очереди». Запуск на GPU — только с разрешения пользователя.
- Этот Next.js новее твоих знаний: перед правкой Next-кода читать `node_modules/next/dist/docs/` (см. `AGENTS.md`).
- Перед сдачей: `npm test` и `npx tsc --noEmit` без ошибок. После переноса маршрутов `tsc` может ругаться на устаревшие `.next/dev/types` — запусти `npm run dev` или `npx next typegen`.
- Новую логику покрывать `node --test` + `tsx` во временной папке (`DATA_ROOT=<tmp>`, `FRAMEBOARD_LOOPS=off`). Тесты лежат рядом с кодом (`*.test.ts`) в своих папках.
- Метаданные результата не дублировать: ComfyUI пишет воркфлоу (промпт, seed) в PNG. Для видео — проверить, что нода сохранения тоже пишет.
- Плейбуки: `.en.md` читает агент, русские — для пользователя. Меняешь смысл в одной версии — обнови вторую в том же коммите.
- Статус этапа пишет только доска. Агент сигналит только `"status": "done"` в `agent_request.json`.
- В модель идёт только `prompt.md`. Рекомендация очищается доской при отправке.
- Новый воркфлоу = JSON графа + манифест, без правки кода.
- В конце — отчёт `docs/briefs/reports/0N-<модуль>.md`: что сделано, что проверено, риски, «Нужно от других модулей».
- `git status` на этой машине может показывать все файлы изменёнными из-за прав доступа. Коммитить с `git -c core.fileMode=false`.
- Коммиты — только в своей ветке. В `main` не мержить.

## Запуск параллельных агентов

Все команды — из корня основного репозитория (`vid-flow`). Пользователь на Windows; команды для Git Bash.

### 1. Worktree на каждый бриф

```bash
git worktree add ../vid-flow-comfy -b comfy-runner contracts
git worktree add ../vid-flow-playbooks -b playbooks contracts
git worktree add ../vid-flow-agent -b agent-bridge contracts
git worktree add ../vid-flow-ui -b ui contracts
```

В каждом worktree один раз: `npm install` (папка `node_modules` у worktree своя).

### 2. Данные и порты

У каждого агента своя временная папка данных и свой порт, чтобы два `next dev` не мешали друг другу и никто не трогал реальный `data/`:

| Бриф | Папка | `DATA_ROOT` | Порт |
|---|---|---|---|
| 3 | `../vid-flow-comfy` | `$TEMP/frameboard-comfy` | 3463 |
| 4 | `../vid-flow-playbooks` | не нужен (код не запускает) | — |
| 5 | `../vid-flow-agent` | `$TEMP/frameboard-agent` | 3465 |
| 6 | `../vid-flow-ui` | `$TEMP/frameboard-ui` | 3466 |

```bash
export DATA_ROOT="$TEMP/frameboard-ui" COMFY_URL=http://127.0.0.1:9
npx next dev -p 3466 -H 127.0.0.1
```

Тестовый эпизод (сервер запущен):

```bash
curl -s -X POST http://127.0.0.1:3466/api/series/episode -H 'content-type: application/json' -d '{"episodeId":"t01"}'
curl -s -X POST http://127.0.0.1:3466/api/series/bootstrap -H 'content-type: application/json' \
  -d '{"episodeId":"t01","scenario":"# Тест\n\n## s01 Кафе\n- characters: katya\n- location: cafe\nКатя входит в кафе.\n"}'
```

Картинки для `refs/` и `approve/` клади во временную папку сам (любой PNG). Папку после работы удали.

### 3. Порядок мержа

1. Пользователь проверяет и мержит `contracts` в `main` (в ней уже `stage-state` и `storage`).
2. Затем ветки брифов по одной, в порядке **4 → 3 → 5 → 6**: каждая следующая опирается на поведение предыдущей (3 читает манифесты из 4, 5 решает «доска запускает этап?» по манифестам из 3, 6 показывает поля из 3 и 5). Файлы не пересекаются, поэтому конфликтов быть не должно.
3. Перед каждым мержем в ветке брифа: `git merge main`, `npm test`, `npx tsc --noEmit`, короткая проверка в браузере на временной `DATA_ROOT`.
4. Мерж делает пользователь или отдельная беседа по его просьбе. После мержа: `git worktree remove ../vid-flow-<модуль>`.
