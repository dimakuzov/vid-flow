# Frameboard

Локальный пульт для структурирования генерации видео.

Один project root = одна серия. Таблица показывает статус каждого shot по этапам:

`characters → location → first_frame → video_preview → final_render`

Файлы — источник правды. UI читает и пишет в директорию серии, поэтому при сбое интерфейса можно работать напрямую с папками.

## Быстрый старт на своём компьютере

```bash
git clone <url-репозитория>
cd <папка-репо>
npm install
npm run dev
```

Открой [http://127.0.0.1:3456](http://127.0.0.1:3456).

По умолчанию серия лежит в `data/series`.  
Глобальные playbooks — в `playbooks/` (общие для всех серий).

Чтобы указать другой корень серии:

```bash
SERIES_ROOT=/absolute/path/to/series npm run dev
```

## Что уже работает

- таблица статусов shot × stage
- клик по клетке → меню: Загрузить / Редактировать / Запустить / Утвердить
- страница этапа: слева input/docs/refs, справа output/approve
- загрузка файлов сразу в проектные папки
- approve с обходом upstream (без warning)
- импорт сценария в структуру папок (UI или агент)
- stub кнопки «Запустить» (ставит `waiting`; Comfy подключим следующим шагом)

## Структура серии

```text
data/series/
  series.md
  scenario.md
  characters/          # база: {name}/portrait.png, side.png, full_body.png
  locations/           # база: {locationId}/ — общий вид
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
- Shot-персонаж собирается из `data/series/characters/` графом `playbooks/workflows/comfy/character_pose_outfit_qwen.json` (открывается в ComfyUI вручную)

## Стек

Next.js + TypeScript + Tailwind + shadcn/ui.  
Данные серии — обычные файлы на диске, без обязательной БД.
