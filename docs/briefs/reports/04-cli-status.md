# Отчёт 04. Агенты доски в строке состояния Claude Code CLI

Ветка `r2-cli-status` (от `bulk-actions`, в ней уже бриф 01), worktree `../vid-flow-r2-cli`.

## Что сделано

- **`runner.ts`.** Живой прогон помнит эпизод, кадр, этап, модель и `startedAt`. Новый `listLiveAgentRuns()` возвращает прогоны этого процесса без отменённых, по времени запуска.
- **`agent-dispatch.ts`.**
  - `listAgentRuns()` → `{ running, queued }` по всем эпизодам. Элемент (`AgentRunEntry`): `kind` (`stage` / `format`), `episodeId`, `shotId`, `stageId`, `provider`, `model`, `since`.
  - `running` — живые прогоны исполнителя плюс разметка сценария, если `isFormatRunLive` и `format_request.json` в `running`.
  - `queued` — `pending` у `ollama` / `claude` без исполнителя, только у этапа в фазе `agent` с тем же `requestId`: ровно те, что фоновый цикл запустит, когда освободится место. Плюс разметка в `pending`.
  - `manual` в список не входит.
  - Модель без явного выбора показана как модель провайдера по умолчанию (`defaultClaudeModel`, `FRAMEBOARD_OLLAMA_MODEL`).
  - `stopAgentRuns(target | "all")` — `cancelStage` на каждую `stage`-запись из обоих списков. Этап без прогона агента доски не трогается: иначе `stop` на этапе в Comfy отменил бы задание в ComfyUI.
- **Маршруты.** `GET /api/agent/runs`; `POST /api/agent/runs/stop` с `{ episodeId, shotId, stageId }` или `{ all: true }` → `{ stopped, running, queued }`. Чужой этап, `..` или пустое тело → 400.
- **`scripts/frameboard-status.mjs`.** Читает stdin, делает `GET http://127.0.0.1:{FRAMEBOARD_PORT:-3456}/api/agent/runs` с таймаутом 500 мс и печатает одну строку:
  - `Frameboard: 2 работают · 3 в очереди` (1 работает / 2 работают / 21 работает);
  - `Frameboard: агентов нет`;
  - `Frameboard: доска выключена`, если нет ответа или таймаут;
  - `Frameboard: ошибка доски (500)`, если ответ не 2xx.
  - Код выхода всегда 0: при ненулевом Claude Code гасит строку.
- **`scripts/frameboard-agents.mjs`.** `list` (таблица: статус, где, провайдер, модель, сколько), `stop <ep>/<shot>/<stage>`, `stop --all`. Плохие аргументы — справка и код 2. Доска не отвечает — понятный текст и код 1. В `package.json`: `npm run agents`, `npm run status-line`.
- **Слэш-команда** `.claude/commands/agents.md`: `/agents list`, `/agents stop --all` запускают скрипт и показывают вывод как есть.
- **Документы.** `docs/contracts/agent-request.md` — строки в «API» и раздел «Агенты доски в CLI». В `README.md` — «Агенты доски в Claude Code».

## Что проверено

- `npm test` — 109/109. Новые тесты в `src/lib/agent/runs.test.ts` (6), подменённый медленный Ollama, `FRAMEBOARD_LOOPS=off`, временная папка:
  - список: один работает, один ждёт, ручной не в списке; закончившийся уходит;
  - разметка в очереди (claude) и не в очереди (manual);
  - остановка одного: abort у провайдера, `cancelled`, этап `idle`, результат не записан, второй остался; этап без прогона → `stopped: []`;
  - остановка всех;
  - 400 на пустое тело, чужой этап, `..`;
  - скрипт строки состояния против HTTP-сервера в тесте: числа, «1 работает», «агентов нет», зависший сервер (таймаут, меньше 3 с), закрытый порт.
- `npx tsc --noEmit` и `npx eslint src scripts` — без ошибок. В свежем worktree перед `tsc` нужен `npx next typegen`.
- Вживую: порт 3474, `DATA_ROOT=$TEMP/frameboard-r2-cli`, `COMFY_URL=http://127.0.0.1:9`, Ollama — заглушка на 11499, которая отвечает через 10 минут (настоящие модели не трогались).
  - «Агенты по кадрам» (`POST /api/episodes/e01/next-stage`, `provider: ollama`) на трёх кадрах.
  - `echo '{}' | node scripts/frameboard-status.mjs` → `Frameboard: 1 работает · 2 в очереди`. Это верно: у Ollama одно место.
  - `npm run agents -- list` показал таблицу.
  - `stop e01/s01/location` снял s01, фоновый цикл сам запустил s02: строка стала `1 работает · 1 в очереди`.
  - `stop --all` снял остальных: `Frameboard: агентов нет`. На диске у всех трёх `cancelled` / `idle`.
  - Доска выключена → `Frameboard: доска выключена` за 0,1 с, `agents list` — текст и код 1.

## Настройка у пользователя

`~/.claude/settings.json` не правился. Добавь сам (путь с прямыми слэшами — на Windows Claude Code запускает команду через Git Bash, обратные слэши там съедаются):

```json
{
  "statusLine": {
    "type": "command",
    "command": "node C:/Users/dimak/Documents/vera/soviet_story/vid-flow/scripts/frameboard-status.mjs",
    "refreshInterval": 5
  }
}
```

- Путь — к основной папке. Скрипт там появится после мержа этой ветки. До мержа — `.../vid-flow-r2-cli/scripts/...`.
- `refreshInterval: 5` — перезапуск раз в 5 с. Без него строка обновляется только на событиях сессии (новое сообщение и т. п.), а агенты доски меняются, пока сессия молчит.
- Доска не на 3456 — `"command": "FRAMEBOARD_PORT=3474 node C:/…/frameboard-status.mjs"`. Так пишется в Git Bash; без Git Bash Claude Code запускает команду в PowerShell, где такая запись не работает.
- Если `statusLine` у тебя уже есть, Claude Code показывает только одну команду. Тогда вызови этот скрипт из своей и выведи его строку отдельной строкой.

Проверка:

```bash
echo '{}' | node C:/Users/dimak/Documents/vera/soviet_story/vid-flow/scripts/frameboard-status.mjs
```

Остановка из сессии Claude Code: `! npm run agents -- list`, `! npm run agents -- stop --all` или `/agents stop --all`.

## Риски

- `running` знает только этот процесс доски. Если запущены две доски на одних данных (основная папка и worktree), каждая покажет свои прогоны, а `queued` у них общий (файлы).
- В строке состояния одна доска — на `FRAMEBOARD_PORT`.
- Разметку сценария не остановить ни из CLI, ни из UI: в `format-runner.ts` нет отмены. CLI так и пишет.
- Строка обновляется не чаще `refreshInterval`. Между обновлениями число может быть старым.
- Слэш-команда `.claude/commands/agents.md` — первый файл в `.claude/` репозитория. Если `.claude/` не должен быть в git, её можно убрать: README даёт и вариант с `!`.

## Нужно от других

- `src/lib/agent/format-runner.ts` (не мой файл): чтобы `stop --all` снимал и разметку, нужна функция `abortFormatRun(episodeId)` — abort контроллера плюс `status: "error"`, «Разметка отменена». Тогда `stopAgentRuns` её вызовет.
