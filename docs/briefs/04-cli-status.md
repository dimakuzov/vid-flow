# Бриф 04. Агенты доски в строке состояния Claude Code CLI

Сначала `docs/briefs/00-overview.md`, затем `docs/contracts/agent-request.md`. Ветка `r2-cli-status`, worktree `../vid-flow-r2-cli`, порт 3474, `DATA_ROOT=$TEMP/frameboard-r2-cli`. Начинать после мержа брифа 01.

## Твои файлы

`src/lib/agent/runner.ts`, `src/lib/series/agent-dispatch.ts`, новые маршруты `src/app/api/agent/runs/route.ts` (и `.../runs/stop/route.ts`), новые `scripts/frameboard-status.mjs`, `scripts/frameboard-agents.mjs`, `package.json` (раздел `scripts`), `docs/contracts/agent-request.md`, `README.md` (раздел про CLI).

## Что нужно пользователю

Агенты доски — фоновые процессы (`claude -p`, запросы к Ollama), запущенные кнопками таблицы. Пользователь хочет видеть их **прямо в Claude Code CLI**: сколько работает, сколько ждёт очереди. И останавливать их оттуда.

## Как сделать

1. **API доски.** `GET /api/agent/runs` → `{ running: [...], queued: [...] }` по всем эпизодам: эпизод, кадр, этап, провайдер, модель, с какого времени. `running` — живые прогоны исполнителя (`runner.ts`: экспортируй список), `queued` — запросы `pending` у провайдеров доски (`ollama`, `claude`), которые ждут места. Плюс разметки сценария (`format-runner.ts`, только читать `isFormatRunLive`). `POST /api/agent/runs/stop` с `{ episodeId, shotId, stageId }` или `{ all: true }` — через `cancelStage` (как «Отменить»).
2. **Строка состояния CLI.** `scripts/frameboard-status.mjs`: читает JSON строки состояния со stdin (его присылает Claude Code), делает `GET http://127.0.0.1:{FRAMEBOARD_PORT:-3456}/api/agent/runs` с таймаутом 500 мс и печатает одну строку: `Frameboard: 2 работают · 3 в очереди` (или `Frameboard: агентов нет`; доска не отвечает — `Frameboard: доска выключена`). Без зависимостей, Node встроенный `fetch`. Документация строки состояния: https://code.claude.com/docs/en/statusline — прочитай её и сделай по ней (поле `statusLine` в `~/.claude/settings.json`, `type: "command"`).
3. **Остановка из CLI.** `scripts/frameboard-agents.mjs`: `list` (таблица прогонов), `stop <ep>/<shot>/<stage>`, `stop --all`. `npm run agents -- list`. В README — как вызвать из сессии Claude Code (`! npm run agents -- list`) и, по желанию, файл слэш-команды `.claude/commands/agents.md`, которая запускает этот скрипт.
4. **Настройка у пользователя.** Не правь `~/.claude/settings.json` сам. В отчёте и README — готовый фрагмент `statusLine` с абсолютным путём к скрипту в репозитории и команда проверки.

## Проверка

- Тесты: список прогонов с подменённым провайдером (один работает, один ждёт), остановка одного и всех, скрипт строки состояния против поднятого в тесте HTTP-сервера (ответ, таймаут, «доска выключена»).
- Вживую на порту 3474: запустить «Агенты по кадрам» с подменённым медленным провайдером или ручным агентом; `echo '{}' | node scripts/frameboard-status.mjs` (с `FRAMEBOARD_PORT=3474`) печатает верные числа; `npm run agents -- stop --all` их останавливает.
- Отчёт `docs/briefs/reports/04-cli-status.md` с фрагментом настроек для пользователя.
