# Команда агенту: собрать структуру серии

Агент (Cursor / Claude) может создать всю файловую структуру без UI.

## Контекст
- Корень серии по умолчанию: `data/series`
- Глобальные playbooks: `playbooks/`
- Этапы каждого shot: `characters`, `location`, `first_frame`, `video_preview`, `final_render`
- Папки этапа: `refs/`, `output/`, `approve/`
- Документы этапа: `prompt.md`, `llm_notes.md`, `refs.md`, `workflow.md`, `status.json`
- `workflow.md` — необязательная заметка на кадр. Можно оставить пустым. Выбор графа там не задаётся.
- `llm_notes.md` — сообщение пользователя агенту («Рекомендация для LLM»). Само по себе агенту не отправляется. Кнопка «Отправить агенту» пишет `agent_request.md` и строку в `data/series/agent_inbox.md`.

## Базы identity
Shot-персонаж и shot-локация собираются из общих баз, а не с нуля:

- `data/series/characters/{name}/` — `portrait.png`, `side.png`, `full_body.png`
- `data/series/locations/{locationId}/` — `view.png` и `description.txt`

Имя персонажа и локации — как в `scenario.md`. Эти папки не заменяют этапы `shots/sXX/characters` и `shots/sXX/location`.

Утверждённый персонаж кадра: `shots/{shotId}/characters/approve/{name}_{shotId}.png`. Отдельной папки `env/` нет.

Перед заполнением этапа прочитай playbook:

- персонаж: `playbooks/stages/characters.md`, `playbooks/models/qwen_image.md`, `playbooks/workflows/characters_comfy.md`
- локация: `playbooks/stages/location.md`, для модели `playbooks/stages/location.en.md`, `playbooks/models/qwen_location.en.md`, `playbooks/workflows/location_comfy.en.md`
- первый кадр: `playbooks/stages/first_frame.md`, для модели `playbooks/stages/first_frame.en.md`, `playbooks/models/qwen_first_frame.en.md`, `playbooks/workflows/first_frame_comfy.en.md`

## Вход
Прочитай `data/series/scenario.md` (весь сценарий серии).

Формат shot-блоков:

```md
## s01 Название кадра
- characters: lena, mark
- location: night_cafe
Текст действия.
```

## Действие
1. Распарси все shots (`s01`, `s02`, ...).
2. Для каждого shot создай `data/series/shots/{shotId}/shot.md`.
3. Для каждого этапа создай папки `refs`, `output`, `approve` и документы этапа.
4. Не затирай существующие файлы в `output/` и `approve/` без явного подтверждения пользователя.
5. Имена approved-персонажей: `{character}_{shotId}.ext`.

## Альтернатива через API приложения
Если dev-server запущен:

```bash
curl -X POST http://127.0.0.1:3456/api/series/bootstrap \
  -H 'content-type: application/json' \
  -d '{"shotIds":["s01","s02","s03"]}'
```

Или через UI: блок «Импорт сценария» на главной.
