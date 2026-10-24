[English](README.md) · Русский

# Frameboard

Локальный пульт для структурирования генерации видео.

Один project root = одна серия. Таблица показывает статус каждого shot по этапам:

`characters → location → first_frame → video_preview → final_render`

Файлы — источник правды. UI читает и пишет в директорию серии, поэтому при сбое интерфейса можно работать напрямую с папками.

## Запуск

```bash
npm install
npm run dev
```

Открой [http://127.0.0.1:3456](http://127.0.0.1:3456). `/` ведёт на открытый эпизод (`data/current_episode.txt`), таблица эпизода — `/e/{episodeId}`, этап — `/e/{episodeId}/shots/{shotId}/{stage}`. Переключатель в шапке меняет адрес и запоминает выбор как эпизод по умолчанию.

Один сериал на репозиторий. Общие папки: `data/characters`, `data/locations`, `data/references`, `data/scenarios`. Эпизоды — в `data/episodes/<имя>/`. Глобальные playbooks — в `playbooks/`.

### Переменные окружения

| Переменная | По умолчанию | Что |
|---|---|---|
| `DATA_ROOT` | `data/` | папка данных (для проб — временная папка) |
| `SERIES_ROOT` | — | папка одного эпизода вместо `data/episodes/*` |
| `COMFY_URL` | `http://127.0.0.1:8188` | ComfyUI. Мёртвый порт (`http://127.0.0.1:9`) — задания висят в «Ожидает очереди», на GPU ничего не уходит |
| `COMFY_TRANSPORT` | `legacy` | `legacy` — прямые HTTP-вызовы (`COMFY_URL`, cloud.comfy.org). `sdk` — официальный `@comfyorg/sdk`, см. [docs/COMFY_SDK.ru.md](docs/COMFY_SDK.md) |
| `COMFY_BASE_URL` | `http://127.0.0.1:8189` | только при `COMFY_TRANSPORT=sdk`: comfy-api-proxy перед локальным ComfyUI |
| `COMFY_CLOUD_API_KEY` | — | ключ Comfy Cloud. Пишите в `.env.local` в корне проекта, не в git |
| `FRAMEBOARD_AGENT_PROVIDER` | `manual` | кто выполняет «Отправить агенту»: `manual`, `ollama`, `claude` |
| `FRAMEBOARD_OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama |
| `FRAMEBOARD_OLLAMA_MODEL` | — | без неё `ollama` недоступен |
| `FRAMEBOARD_CLAUDE_BIN` | `claude` | путь к CLI `claude` (подписка, без API-ключа) |
| `FRAMEBOARD_AGENT_TEXT_TIMEOUT_MIN` / `_RUN_TIMEOUT_MIN` / `_TIMEOUT_MIN` | 5 / 30 / 60 | таймауты text, agent и ручного режима |
| `FRAMEBOARD_LOOPS` | — | `off` выключает фоновые циклы (тесты) |

```bash
DATA_ROOT=/tmp/frameboard COMFY_URL=http://127.0.0.1:9 npx next dev -p 3466 -H 127.0.0.1
```

### Фоновые циклы

Отдельного воркера нет. Очередь ComfyUI (раз в 2 с) и цикл агента (раз в 3 с, все эпизоды) работают внутри процесса Next: `src/instrumentation.ts` → `src/lib/background.ts`. Пока запущен `npm run dev`, задания уходят в ComfyUI сами. `npm run comfy-queue` — отладочный запуск очереди без доски, вместе с `npm run dev` не запускать.

### Агенты доски в Claude Code

Агенты, которых запускает доска (`claude -p`, запросы к Ollama), видны в строке состояния Claude Code CLI: `Frameboard: 2 работают · 3 в очереди`, `Frameboard: агентов нет` или `Frameboard: доска выключена`.

Строка состояния — поле `statusLine` в `~/.claude/settings.json` ([документация](https://code.claude.com/docs/en/statusline)). Путь — с прямыми слэшами (на Windows Claude Code запускает команду через Git Bash):

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /path/to/frameboard/scripts/frameboard-status.mjs",
    "refreshInterval": 5
  }
}
```

`refreshInterval` нужен: без него строка обновляется только на событиях сессии, а агенты доски меняются, пока сессия молчит. Доска не на 3456 — добавь в начало команды `FRAMEBOARD_PORT=3474 ` (так пишется в Git Bash; без Git Bash Claude Code запускает команду в PowerShell, там переменную так не задать). Проверка:

```bash
echo '{}' | node scripts/frameboard-status.mjs
```

Список и остановка — тот же API, что у кнопки «Отменить»:

```bash
npm run agents -- list
npm run agents -- stop e01/s03/location
npm run agents -- stop e01/format
npm run agents -- stop --all
```

В сессии Claude Code — с `!` в начале: `! npm run agents -- list`. Или слэш-командой `/agents list`, `/agents stop --all` (`.claude/commands/agents.md`). Разметка сценария (кнопка «Добавить») останавливается как `e01/format`.

## Что умеет доска

- таблица кадр × этап; на телефоне — карточки кадров. Клик по клетке — меню: загрузить, утвердить, выбрать воркфлоу, запустить, отменить, «Редактировать»
- страница этапа: полоса состояния (фаза и время, место в очереди ComfyUI, текст ошибки и ошибки нод, «Отменить» / «Сбросить ошибку»), меню воркфлоу из манифестов, предложение агента «Переключить»
- `prompt.md` — ровно текст для модели; над ним действие кадра из `shot.md`. История версий промпта с возвратом
- «Отправить агенту»: рекомендация, выбор провайдера (запоминается в браузере), статус запроса. Пока агент или ComfyUI работают, этап закрыт
- поля не затираются опросом: если файл изменился на диске, пока поле правят, — плашка «подтянуть?»
- полноэкранный просмотр output с промптом и seed из PNG ComfyUI
- импорт сценария в папки кадров (UI или агент)

Контракты между модулями — [`docs/contracts/`](docs/contracts/): папка этапа и API, манифест графа, задание очереди, запрос агенту.

## Структура серии

```text
data/
  show.md
  current_episode.txt
  characters/          # база: {name}/portrait.png, side.png, full_body.png
  locations/           # база: {locationId}/ — общий вид
  references/          # общие референсы сериала
  scenarios/           # документы сценариев
  episodes/
    e01/
      episode.md
      scenario_raw.md  # сырой текст для агента
      scenario.md      # кадры ## s01, их читает скрипт
      format_request.md
      agent_inbox.md
      shots/
        s01/
          shot.md
          characters/
            refs/
            output/
            approve/
            prompt.md
            llm_notes.md
            refs.md
            workflow.md
            status.json
          location/
          first_frame/
          video_preview/
          final_render/
```

Имена персонажей в approve: `lena_s01.png`, `mark_s01.png`.

## Режимы агента

«Отправить агенту» просит языковую модель переписать промпт этапа (`prompt.md`) по вашей заметке. Модель здесь помощник, а не обязательное условие: `prompt.md` — обычное текстовое поле, его можно править руками в доске, а ComfyUI доска запускает сама. Провайдер выбирается через `FRAMEBOARD_AGENT_PROVIDER` или в меню этапа.

| Провайдер | Что нужно | Что делает |
|---|---|---|
| `manual` (по умолчанию) | Любой чат-агент, который читает и пишет файлы проекта (Claude Code, Cursor, Gemini CLI и т. п.), или вы сами | Доска пишет задачу в `llm_task.md` и ждёт. Агент (или вы) обновляет `prompt.md` и ставит `"status": "done"` в `agent_request.json`. Автоматически ничего не вызывается |
| `ollama` | Запущенный локально [Ollama](https://ollama.com) и `FRAMEBOARD_OLLAMA_MODEL` | Открытые веса, всё локально. Только режим text: переписывает `prompt.md` для этапов с воркфлоу доски (локация, первый кадр, видео) |
| `claude` | CLI `claude` ([Claude Code](https://claude.com/claude-code)) с подпиской, API-ключ не нужен | Режим text и режим agent для этапов без воркфлоу доски (персонажи): CLI работает в пустой папке с файлом задачи. Модели: по умолчанию Haiku 5.5, Sonnet 5.5 для первого кадра, Opus 5.5 для разметки сырого сценария |

Два режима внутри доски:

- **text**: модель возвращает только новый промпт. Доска сохраняет его и сама ставит задание в ComfyUI.
- **agent**: CLI-агент выполняет задачу из файла, затем доска продолжает.

Разметка сырого сценария в кадры («Отправить на разметку») тоже требует агента. Без него напишите `scenario.md` сами в формате блоков кадров из `docs/AGENT_BOOTSTRAP.md`.

Если модели нет совсем: не нажимайте «Отправить агенту», правьте промпты руками и пользуйтесь доской как файловой очередью заданий и таблицей проверки.

## Агент и playbooks

- Инструкция агенту по сборке структуры: `docs/AGENT_BOOTSTRAP.md`
- Гайды модели и этапа: `playbooks/`. Страница этапа показывает связанные файлы
- Shot-персонаж — правка одежды базы из `data/characters/` по образцу в `refs/`: граф `playbooks/workflows/comfy/character_outfit_qwen21.json`
- Сырой сценарий: кнопка «Отправить на разметку» пишет `scenario_raw.md` и строку в `agent_inbox.md`. Агент в Cursor форматирует его в `scenario.md`. «Создать выбранные» — отдельный скрипт, он только создаёт папки из уже размеченного текста

## Стек

Next.js + TypeScript + Tailwind + shadcn/ui.  
Данные серии — обычные файлы на диске, без обязательной БД.

## Лицензия

MIT, см. [LICENSE](LICENSE). Код можно использовать и продавать, в том числе коммерчески, но уведомление об авторских правах должно оставаться в каждой копии, то есть авторство указывается. Лицензия покрывает только код этого репозитория. У моделей и инструментов, которые вы запускаете с доской, свои лицензии; см. [NOTICE.md](NOTICE.md).
