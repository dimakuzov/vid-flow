# Бриф 5. Связь с агентом

Сначала прочитай `docs/briefs/00-overview.md`, затем `docs/contracts/agent-request.md`, `docs/contracts/stage-folder.md`, `docs/contracts/graph-binding.md` (разделы про выбор варианта).

Ветка `agent-bridge`, worktree `../vid-flow-agent`, `DATA_ROOT=$TEMP/frameboard-agent`, порт 3465, `COMFY_URL=http://127.0.0.1:9`.

## Твои файлы (правишь только их)

- `src/lib/series/agent-request.ts`, `src/lib/series/agent-dispatch.ts`, `src/lib/series/format-request.ts`
- `src/lib/series/stage-state.test.ts` (тесты переходов бриф 1 — обновляй, если меняешь поведение запроса)
- новая папка `src/lib/agent/**` (провайдеры, исполнитель, тесты)
- `src/app/api/episodes/[episodeId]/shots/[shotId]/stages/[stage]/agent-request/route.ts`, `.../cancel/route.ts`
- `src/app/api/series/format-request/route.ts`
- новая папка `src/app/api/agent/**` (`GET /api/agent/providers`)
- `AGENTS.md`, `CLAUDE.md`, `docs/AGENT_BOOTSTRAP.md`, `agent-mail/**`

Не трогаешь: `src/lib/comfy/**` (только вызываешь `queueStageRun`, `cancelComfyJob`, `listWorkflowChoices`, `resolveWorkflowId`), `src/lib/contracts/**`, остальное `src/lib/series/**`, UI, `playbooks/**`.

## Что уже есть

- Фазы, блокировка, отмена, таймаут ручного агента, очистка `llm_notes.md` — бриф 1.
- Явный `episodeId` везде; цикл `reconcileAllStages` обходит все эпизоды; `agent_request.json` хранит `episodeId` — бриф 2.
- Типы `AgentRequestFile` (со статусами `running`/`error`, полями `provider`, `mode`, `startedAt`, `finishedAt`, `error`, `suggestedWorkflow`), `AgentProvider`, `AgentTask`, `AgentResult`, `AgentProviderInfo` — `src/lib/contracts/agent-request.ts`. `StageDetail.agentRequest` уже отдаёт `provider`, `error`, `suggestedWorkflow`.
- `agent_dispatch.json` хранит `workflow` (id манифеста); маршрут принимает `runWorkflow` (и старое `videoWorkflow`). `queueAfterAgent` передаёт его в `queueStageRun`.
- Цикл регистрируется через `registerLoop` (`startAgentDispatch`) — горячая перезагрузка подменяет функцию.
- На машине пользователя запущен Ollama (`127.0.0.1:11434`). `claude` в PATH этой оболочки нет — провайдер `claude` должен честно показывать «не найден», путь задаётся `FRAMEBOARD_CLAUDE_BIN`.

## Задачи

1. **Провайдеры** (`src/lib/agent/`): `manual`, `ollama` (text), `claude` (text и agent) по контракту. `check()` — доступность без побочных эффектов. Настройка — переменные из контракта.
2. **Исполнитель.** После `submitAgentRequest` (или из цикла для `pending`) запускает провайдера в фоне: `pending → running → done | error`, `AbortController` на запрос, таймауты режимов. text: сборка `AgentTask.system` из плейбука выбранного воркфлоу (`WorkflowChoice.playbook`; нет — `stages/<stage>.en.md`) и `user` (сообщение, текущий `prompt.md`, действие из `shot.md`, имена `refs/`, персонажи); ответ → `prompt.md` через `updateStageDocs` (история промпта), `agent_baseline.json`, `done`. agent: `claude -p` в корне репо с `llm_task.md`, вывод в `run_log.md`, код выхода → `done`/`error`. Результат после отмены не писать.
3. **Цикл.** `reconcileStage`: запрос `error` → фаза `error` с текстом; `running` без живого исполнителя в этом процессе → `error` «доска перезапущена, пока работал агент»; остальное как сейчас.
4. **Отмена.** `cancelStage` прерывает исполнителя (HTTP к Ollama, процесс `claude` вместе с дочерними).
5. **Когда доска запускает этап сама.** `stageBoardQueues` → «у этапа есть доступный вариант» (`listWorkflowChoices(...).some(c => c.available)`), а не список этапов в коде. Режим запроса: text, если доска запускает; иначе agent (или manual).
6. **Один документ задачи.** `llm_task.md` — самодостаточный текст задачи (для agent и manual). Убери `agent_request.md` или сведи его к ссылке. Включи действие кадра из `shot.md` (сейчас его в задаче нет). Шаблоны без противоречий с контрактом (ни слова про `status.json`, `stage_state.json`, очистку `llm_notes.md`).
7. **`AGENTS.md` короче.** Только: где взять задачу (`agent_inbox.md` → `llm_task.md`), единственный сигнал — `done`, что не трогать, где плейбуки. Убери «проверяй каждые 20 секунд», устаревшие ссылки на `SERIES_ROOT` как «текущий эпизод», и раздел про ветку `cursor/episode-folders-7482`, если решишь, что `agent-mail/` — ручной инструмент. Решение по `agent-mail/` запиши. Блок `<!-- BEGIN:nextjs-agent-rules -->…<!-- END:nextjs-agent-rules -->` оставь дословно: `next dev` в других worktree дописывает его заново, и любая правка блока даст им изменённый `AGENTS.md`.
8. **API.** `GET /api/agent/providers` → `AgentProviderInfo[]`. `POST .../agent-request` принимает `provider` (нет — `FRAMEBOARD_AGENT_PROVIDER`), `runWorkflow`; неподходящий провайдер для режима → 400 с понятным текстом.
9. Низкий приоритет, только если останется время: «Попросить агента оценить результат» — не делай в этом раунде, запиши предложение в отчёт.

## Проверка

- Тесты (`src/lib/agent/*.test.ts`) с подменёнными провайдерами: text-режим переписывает `prompt.md` и ведёт к `queued`; ошибка провайдера → фаза `error`; отмена во время `running` прерывает и не пишет результат; таймаут; перезапуск (running без исполнителя) → `error`; неподходящий режим → 400.
- Вживую на порту 3465: провайдер `ollama` на location одного тестового кадра (модель — любая уже скачанная, `ollama list`; не скачивай новых без спроса) → `prompt.md` переписан, этап в «Ожидает очереди». ComfyUI не трогать.
- `npm test`, `npx tsc --noEmit` чистые.

## Нужно от других

- Бриф 3 заменяет тело `listWorkflowChoices` на манифесты; до мержа работает временный список с тем же поведением.
- Бриф 6 показывает выбор провайдера (`GET /api/agent/providers`), статус и ошибку запроса, `suggestedWorkflow`.
