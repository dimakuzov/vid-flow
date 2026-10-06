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

## Агент и playbooks

- Инструкция агенту по сборке структуры: `docs/AGENT_BOOTSTRAP.md`
- Гайды модели и этапа: `playbooks/`. Страница этапа показывает связанные файлы
- Shot-персонаж по умолчанию — правка одежды из `data/characters/`. Граф со скелетом `playbooks/workflows/comfy/character_pose_outfit_qwen.json` только если явно просят конкретную позу с референса
- Сырой сценарий: кнопка «Отправить на разметку» пишет `scenario_raw.md` и строку в `agent_inbox.md`. Агент в Cursor форматирует его в `scenario.md`. «Создать выбранные» — отдельный скрипт, он только создаёт папки из уже размеченного текста

## Стек

Next.js + TypeScript + Tailwind + shadcn/ui.  
Данные серии — обычные файлы на диске, без обязательной БД.
