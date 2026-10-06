# Frameboard: карта модулей и общие правила

Читать каждому агенту перед своим брифом. Папку `data/` не просматривать целиком: там контент эпизода. Открывать в ней только конкретные служебные файлы, если они нужны для проверки (json/md этапа одного кадра).

## Как устроен поток

```
UI (Next.js)  ──HTTP──>  API routes  ──>  lib/series (файлы на диске = источник правды)
                                             │
            «Отправить агенту»               ├─ agent_request.json/.md, llm_task.md, agent_inbox.md
                                             │        ↑ внешний агент (Cursor/Claude) сам опрашивает файлы
            agent-dispatch (каждые 3 с)  ────┤  status done → queueStageRun
            «Запустить»                  ────┤
                                             ↓
                                   lib/comfy/stage-run  (граф из playbooks + подстановка по node id)
                                             ↓
                                   data/comfy_queue/<id>.json
                                             ↓
                                   lib/comfy/queue (каждые 2 с) ──> ComfyUI :8188 ──> output/
```

Фоновые циклы (`agent-dispatch`, `comfy queue`) стартуют внутри процесса Next через `src/instrumentation.ts`.

## Модули и владельцы

| # | Модуль | Файлы-владения | Бриф |
|---|---|---|---|
| 1 | **Сквозная задача:** единое состояние этапа, блокировка клетки, очистка рекомендации | все модули, только в объёме задачи | `01-stage-state.md` |
| 2 | Хранилище | `src/lib/series/{paths,status,media,mutations,scanner,prompt-history,shot-meta,bootstrap,types,constants,stage-state}.ts`, `scripts/bootstrap-sample.ts` | `02-storage.md` |
| 3 | Запуск в ComfyUI | `src/lib/comfy/*`, `scripts/comfy-queue.ts`, `src/instrumentation.ts`, `src/app/api/comfy/**`, `.../run/route.ts` | `03-comfy-runner.md` |
| 4 | Воркфлоу и инструкции | `playbooks/**` | `04-workflows.md` |
| 5 | Связь с агентом | `src/lib/series/{agent-request,agent-dispatch,format-request}.ts`, `AGENTS.md`, `docs/AGENT_BOOTSTRAP.md`, `agent-mail/`, `.../agent-request/route.ts` | `05-agent-bridge.md` |
| 6 | Интерфейс | `src/components/**`, `src/app/**/page.tsx`, `src/app/layout.tsx`, `globals.css` | `06-ui.md` |

## Порядок

1. Бриф 1 — один агент, до всех остальных.
2. Брифы 2, 3, 4 — можно параллельно, каждый в своём git worktree (см. ниже). 4 почти не пересекается с кодом. 2 и 3 пересекаются только через сигнатуры с `episodeId` — 2 мержить первым.
3. Брифы 5 и 6 — после мержа 2–4.

Параллельная работа: каждый агент в отдельной копии репозитория, `git worktree add ../vid-flow-<модуль> -b <модуль>`, с `DATA_ROOT`, указывающим на временную папку. Мерж в основную ветку делает пользователь или отдельная беседа по одному.

API routes в `src/app/api/**` — тонкие обёртки. Правит тот модуль, чью функцию route вызывает.

## Общие контракты (меняются только по согласованию)

1. **Структура папки этапа**: `refs/ output/ approve/ prompt.md llm_notes.md refs.md workflow.md status.json run_log.md prompt_history.json agent_*.json`. Описание контракта: `docs/contracts/stage-folder.md` (создаёт бриф 1, дополняет модуль 2).
2. **`src/lib/series/types.ts` и `constants.ts`** — владелец модуль 2. Остальные не правят, а пишут в своём отчёте, какое поле нужно.
3. **Схема задания очереди** `data/comfy_queue/<id>.json` (`ComfyJob`) — владелец модуль 3. Контракт: `docs/contracts/comfy-job.md`.
4. **Манифест привязки графа** (какой node id получает картинку, текст, seed, prefix) — формат задаёт модуль 3, сами манифесты сопровождает модуль 4. Контракт: `docs/contracts/graph-binding.md`.
5. **Жизненный цикл запроса агенту** (`agent_request.json` → `done` → dispatch) — владелец модуль 5. Контракт: `docs/contracts/agent-request.md`.

Если правка требует изменить чужой файл, не правь его: опиши нужное изменение в разделе «Нужно от других модулей» своего отчёта.

## Общие правила для всех

- `data/` не коммитить и не удалять из неё файлы.
- Этот Next.js новее твоих знаний: перед правкой Next-кода читать `node_modules/next/dist/docs/` (см. `AGENTS.md`).
- Проверка перед сдачей: `npx tsc --noEmit` без новых ошибок. Сейчас есть одна старая ошибка: `src/components/board/series-board.tsx:154`, `onClick={reload}` (её чинит модуль 6).
- Метаданные результата не дублировать: ComfyUI сам пишет весь воркфлоу (промпт, seed) в метаданные PNG. Для видео проверить, что нода сохранения тоже пишет метаданные.
- Плейбуки: `.en.md` читает агент, русские — для пользователя. Меняешь смысл в одном — обнови и второй.
- Тестов в проекте нет. Новую логику покрывать `node --test` + `tsx` на временной папке (`DATA_ROOT=<tmp>`), не на реальном `data/`.
- В конце работы записать отчёт `docs/briefs/reports/<номер>-<модуль>.md`: что сделано, что сломано/рискованно, «Нужно от других модулей».
- `git status` на этой машине показывает все файлы изменёнными из-за прав доступа (fileMode). Коммитить с `git -c core.fileMode=false`.
