# Команда агенту: эпизод и структура кадров

Один сериал на репозиторий. Агент работает с файлами, доска сама агента не запускает.

## Контекст
- Общие базы: `data/characters/{name}/`, `data/locations/{locationId}/`
- Общие референсы сериала: `data/references/`. Это не `refs/` кадра
- Документы сценариев: `data/scenarios/`. Рабочий текст текущей серии по-прежнему `data/episodes/{episodeId}/scenario.md`
- Эпизоды: `data/episodes/{episodeId}/`
- Текущий эпизод: `data/current_episode.txt`
- Сырой сценарий: `data/episodes/{episodeId}/scenario_raw.md`
- Размеченный сценарий: `data/episodes/{episodeId}/scenario.md`
- Входящие: `data/episodes/{episodeId}/agent_inbox.md`
- Глобальные playbooks: `playbooks/`
- Этапы каждого shot: `characters`, `location`, `first_frame`, `video_preview`, `final_render`
- Папки этапа: `refs/`, `output/`, `approve/`
- Документы этапа: `prompt.md`, `llm_notes.md`, `refs.md`, `workflow.md`, `status.json`
- `workflow.md` — необязательная заметка на кадр. Можно оставить пустым. Выбор графа там не задаётся.
- `llm_notes.md` — поле ввода рекомендации на доске. Кнопка «Отправить агенту» переносит текст в `agent_request.md`/`llm_task.md`, пишет строку в `agent_inbox.md` эпизода и очищает поле. Агент `llm_notes.md`, `status.json` и `stage_state.json` не трогает: их ведёт доска. Журнал прогона — в `run_log.md`. Предыдущие тексты промпта — в `prompt_history.json`, их можно вернуть с этапа.
- `prompt.md` — ровно тот текст, который уходит в модель.

## Сырой сценарий
Если во входящих есть `format-scenario` со статусом `pending`:

1. Прочитай `format_request.md` и `scenario_raw.md` текущего эпизода.
2. Запиши `scenario.md` блоками кадров. Сюжет не выдумывай.
3. Папки `shots/` не создавай.
4. Поставь `"status": "done"` в `format_request.json`.

Формат:

```md
# Название эпизода

## s01 Название кадра
- characters: lena, mark
- location: night_cafe
- duration: 6
- speech: Лена: Ты опоздал.
Текст действия.
```

`duration` — длительность клипа, 2–12 секунд. `speech` — реплика дословно, одна на строку; никто не говорит — строк нет. Доска при создании кадров кладёт реплики в `shots/{shotId}/speech.md`, длительность — в выбор длительности этапа видео. Полные правила — `FORMAT_RULES` в `src/lib/series/format-request.ts` (их же получает модель разметки).

## Базы identity
Shot-персонаж и shot-локация собираются из общих баз, а не с нуля:

- `data/characters/{name}/` — `portrait.png`, `side.png`, `full_body.png`
- `data/locations/{locationId}/` — `view.png` и `description.txt`

Имя персонажа и локации — как в `scenario.md` эпизода. Эти папки не заменяют этапы `data/episodes/{episodeId}/shots/sXX/characters` и `.../location`.

Утверждённый персонаж кадра: `shots/{shotId}/characters/approve/{name}_{shotId}.png`. Отдельной папки `env/` нет.

Перед заполнением этапа прочитай playbook:

- персонаж: `playbooks/stages/characters.en.md`, `playbooks/models/qwen_image.en.md`, `playbooks/workflows/characters_comfy.en.md`. Прогон — раздел «Команда» в workflow, его выполняют и Cursor, и Claude
- локация: `playbooks/stages/location.en.md`, для модели `playbooks/stages/location.en.md`, `playbooks/models/qwen_location.en.md`, `playbooks/workflows/location_comfy.en.md`
- первый кадр: `playbooks/stages/first_frame.en.md`, для модели `playbooks/stages/first_frame.en.md`, `playbooks/models/qwen_first_frame.en.md`, `playbooks/workflows/first_frame_comfy.en.md`

## Собрать папки кадров
Это отдельный шаг после разметки. Прочитай `scenario.md` текущего эпизода.

1. Распарси все shots (`s01`, `s02`, ...).
2. Для каждого shot создай `data/episodes/{episodeId}/shots/{shotId}/shot.md`.
3. Для каждого этапа создай папки `refs`, `output`, `approve` и документы этапа.
4. Не затирай существующие файлы в `output/` и `approve/` без явного подтверждения пользователя.
5. Имена approved-персонажей: `{character}_{shotId}.ext`.

Кнопка «Создать выбранные» делает то же самое скриптом внутри доски. Агента она не вызывает. Если в тексте нет заголовков `## s01`, скрипт папки не создаёт.

## Альтернатива через API приложения
Если dev-server запущен:

```bash
curl -X POST http://127.0.0.1:3456/api/series/bootstrap \
  -H 'content-type: application/json' \
  -d '{"episodeId":"e01","shotIds":["s01","s02","s03"]}'
```

Или через UI: блок «Эпизод и сценарий» на главной.
