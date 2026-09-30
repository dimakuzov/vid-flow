# Команда агенту: собрать структуру серии

Агент (Cursor / Claude) может создать всю файловую структуру без UI.

## Контекст
- Корень серии по умолчанию: `data/series`
- Глобальные playbooks: `playbooks/`
- Этапы каждого shot: `characters`, `location`, `first_frame`, `video_preview`, `final_render`
- Папки этапа: `refs/`, `output/`, `approve/`
- Документы этапа: `prompt.md`, `llm_notes.md`, `refs.md`, `workflow.md`, `status.json`

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
