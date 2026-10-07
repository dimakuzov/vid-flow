# Frameboard, раунд 2: обзор и правила

Читать каждому агенту перед своим брифом. Прошлый раунд — в `docs/briefs/archive/round-1/` (только для справки, не задачи).

## Как устроена доска сейчас

```
UI (Next.js, /e/{ep}/...) ──HTTP──> /api/episodes/{ep}/shots/{shot}/stages/{stage}/...  ──> src/lib/series (файлы = правда)
   │                                                     │
   ├ кнопки таблицы (bulk-menu.tsx) ──> /api/episodes/{ep}/{next-stage, stages/{stage}/run-all}, .../shots/{shot}/next-stage
   ├ «Отправить агенту» ──> agent_request.json ──> src/lib/agent (провайдеры manual / ollama / claude, модель, очередь)
   ├ «Добавить» в шапке ──> /api/series/new-episode ──> src/lib/agent/format-runner.ts (разметка сценария моделью)
   └ «Запустить» ──> src/lib/comfy (граф + манифест *.bind.json) ──> data/comfy_queue ──> ComfyUI :8188 ──> output/
```

Контракты — `docs/contracts/`: папка этапа и API (`stage-folder.md`), манифест графа (`graph-binding.md`), задание очереди (`comfy-job.md`), запрос агенту (`agent-request.md`). Фоновые циклы — внутри процесса Next (`src/lib/background.ts`).

## Брифы этого раунда

| Бриф | Что | Когда |
|---|---|---|
| `01-stage-files.md` | Удаление файлов output/ и refs/, скрытая заметка workflow.md, показ всех входов этапа | **первым** |
| `02-location-library.md` | Локация: выбор из библиотеки `data/locations/`, граф Krea 2 и плейбук | после 01, параллельно с 03 и 04 |
| `03-video-duration.md` | Видео (превью): выбор длительности клипа | после 01, параллельно с 02 и 04 |
| `04-cli-status.md` | Число агентов доски в строке состояния Claude Code CLI и их остановка | после 01, параллельно с 02 и 03 |

Бриф 01 меняет страницу этапа, которую трогают и остальные. Поэтому сначала он, потом остальные три параллельно — их файлы не пересекаются.

## Кто какие файлы правит

| Бриф | Файлы |
|---|---|
| 01 | `src/components/stage/{stage-workspace,ref-files,output-panel,media-card}.tsx`, новые `src/components/stage/stage-inputs.tsx`, `src/lib/series/{mutations,scanner,types}.ts`, новый `src/lib/series/stage-inputs.ts`, новый маршрут `src/app/api/episodes/[episodeId]/shots/[shotId]/stages/[stage]/files/route.ts`, `docs/contracts/stage-folder.md`, `AGENTS.md` (строка про удаление файлов) |
| 02 | новые `src/components/stage/location-library.tsx`, `src/lib/series/library.ts`, маршруты `src/app/api/library/locations/**` и `src/app/api/episodes/[episodeId]/shots/[shotId]/stages/[stage]/refs-from-library/route.ts`; одна строка вставки в `stage-workspace.tsx`; `playbooks/**` (Krea 2: граф, манифест, плейбуки локации) |
| 03 | `src/components/stage/workflow-menu.tsx`, `src/lib/series/run-settings.ts`, `src/lib/series/scanner.ts`, `src/lib/series/types.ts`, `src/app/api/episodes/[episodeId]/shots/[shotId]/stages/[stage]/route.ts`, `src/lib/comfy/binding.ts`, `src/lib/contracts/graph-binding.ts`, `src/lib/agent/task.ts`, `playbooks/workflows/comfy/{video,final}_*.bind.json`, `playbooks/models/wan_video*.md`, `docs/contracts/graph-binding.md` |
| 04 | `src/lib/agent/runner.ts`, `src/lib/series/agent-dispatch.ts`, новые маршруты `src/app/api/agent/runs/**`, новые `scripts/frameboard-status.mjs`, `scripts/frameboard-agents.mjs`, `package.json` (раздел `scripts`), `docs/contracts/agent-request.md`, `README.md` (раздел про CLI) |

Пересечение 02 ↔ 03: нет. Бриф 02 правит в `stage-workspace.tsx` одну строку (вставка кнопки у «Референсы»); 03 этот файл не трогает. Нужна правка чужого файла — опиши её в отчёте, не делай сам.

## Общие правила

- `data/` — реальный проект пользователя. Не открывать целиком, ничего не удалять и не перезаписывать. Проверки — во временной папке: `DATA_ROOT=<tmp>`.
- Реальные задания в ComfyUI не отправлять без согласия пользователя: `COMFY_URL=http://127.0.0.1:9`. Ollama и Claude на настоящих моделях не гонять без согласия: в тестах — подменённый провайдер (`overrideAgentProvider`).
- Этот Next.js новее твоих знаний: перед правкой Next-кода читать `node_modules/next/dist/docs/` (см. `AGENTS.md`).
- Плейбуки: `.en.md` читает агент, русские — для пользователя. Меняешь смысл в одной — обнови вторую в том же коммите.
- В модель идёт только `prompt.md`. Статус этапа пишет только доска.
- Перед сдачей: `npm test`, `npx tsc --noEmit`, `npx eslint src scripts` — без ошибок. Новую логику покрывать тестами `node --test` во временной папке, `FRAMEBOARD_LOOPS=off`.
- В конце — отчёт `docs/briefs/reports/0N-<имя>.md`: что сделано, что проверено, риски, «Нужно от других».
- Коммитить с `git -c core.fileMode=false`. Коммиты — только в своей ветке, в `main` не мержить.
- Если у пользователя запущен `npm run dev` в основной папке, второй `next dev` там не стартует. Проверять в своём worktree на своём порту.

## Запуск агентов

Основа — ветка `bulk-actions` (в ней всё прошлое: PR #4 и кнопки таблицы). Если пользователь уже смержил её в `main`, основа — `main`.

```bash
git worktree add ../vid-flow-r2-files -b r2-stage-files bulk-actions
```

После мержа брифа 01:

```bash
git worktree add ../vid-flow-r2-location -b r2-location-library bulk-actions
git worktree add ../vid-flow-r2-duration -b r2-video-duration bulk-actions
git worktree add ../vid-flow-r2-cli -b r2-cli-status bulk-actions
```

(вместо `bulk-actions` — ветка, куда смержен 01). В каждом worktree один раз `npm install`.

| Бриф | Порт | `DATA_ROOT` |
|---|---|---|
| 01 | 3471 | `$TEMP/frameboard-r2-files` |
| 02 | 3472 | `$TEMP/frameboard-r2-location` |
| 03 | 3473 | `$TEMP/frameboard-r2-duration` |
| 04 | 3474 | `$TEMP/frameboard-r2-cli` |

Порядок мержа: 01 → 02, 03, 04 в любом порядке. Перед мержем — `git merge <основа>` в ветке брифа, тесты, проверка в браузере.
