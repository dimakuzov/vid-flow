# Бриф 2. Хранилище

Сначала прочитай `docs/briefs/00-overview.md` и отчёт брифа 1 в `docs/briefs/reports/`.

## Зона
`src/lib/series/{paths,status,media,mutations,scanner,prompt-history,shot-meta,bootstrap,types,constants,labels,stage-state}.ts`, `scripts/bootstrap-sample.ts`, `src/app/api/series/**`, `src/app/api/media/**`, `src/app/api/shots/[shotId]/route.ts`, `.../stages/[stage]/{route,approve,upload,prompt-history}/route.ts`, `.../watch/route.ts`.

## Задачи

1. **Явный эпизод вместо «открытого».** У каждого эпизода своя папка (`data/episodes/<id>/`). Но функции не получают эпизод параметром: каждая заново читает `data/current_episode.txt` — «какой эпизод сейчас открыт в шапке». Последствия:
   - результат прогона, закончившегося после переключения эпизода, может отметиться в кадре с тем же номером в другом эпизоде (бриф 1 закрывает это для очереди частично);
   - запросы агенту в неоткрытом эпизоде не уходят в Comfy;
   - URL медиа строятся относительно папки эпизода, поэтому файлы из `data/characters/` показать нельзя.
   Сделай `episodeId` параметром во всех функциях модуля (`stageDir(episodeId, shotId, stage)` и т. п.) и в API-путях. `current_episode.txt` остаётся только выбором по умолчанию для UI. Вызовы в чужих модулях поменяй минимально (только аргументы) и перечисли в отчёте.
2. **Чтение без побочных записей (низкий приоритет).** Папки этапов нужны и остаются. Но `scanSeries()` при каждом опросе запускает миграцию старой раскладки (`migrateLegacySeriesLayout`) и пишет `show.md`. Перенеси миграцию в старт приложения. История промпта при чтении пусть остаётся, если это самый надёжный способ поймать правку агента.
3. **Медиа вне эпизода.** `/api/media` должен уметь отдавать файлы из `data/characters/`, `data/locations/`, `data/references/` (только чтение, внутри `data/`). Поправь проверку пути: `startsWith(root)` без разделителя пропускает `e010` при `e01`.
4. **`data-backup/`** (80 файлов старой раскладки) лежит в git. Предложи удалить в отчёте, сам не удаляй.

## Результат
- `docs/contracts/stage-folder.md` дополнен: какие функции требуют `episodeId`, маршруты API.
- Тесты на `parseScenario`, `approveFiles` для персонажей (сопоставление имён файлов), `deriveStageStatus` с фазой из брифа 1.

## Не трогать
Логику очереди Comfy, шаблоны задач агенту, `playbooks/`, компоненты UI.
