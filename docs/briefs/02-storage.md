# Бриф 2. Хранилище — ВЫПОЛНЕН

Ветка `storage` (от `stage-state`). Отчёт: `docs/briefs/reports/02-storage.md`. Контракт: `docs/contracts/stage-folder.md`, разделы «Эпизод — всегда явный параметр» и «API».

Итог:
- `episodeId` — первый параметр всех функций хранилища и `queueStageRun`; `current_episode.txt` — только выбор по умолчанию для `/`.
- Маршруты кадров — `/api/episodes/{ep}/shots/{shot}/...`; `GET /api/episodes/{ep}` — сводка эпизода.
- Фоновый цикл обходит все эпизоды; задание очереди и запрос агенту хранят `episodeId`.
- `/api/media` отдаёт `episodes/<ep>/...` и общие библиотеки `characters|locations|references`; проверка пути с разделителем.
- `scanSeries()` ничего не пишет; миграция старой раскладки — `prepareDataRoot()` при старте.

Не сделано (решение пользователя): удалить `data-backup/` из git — см. отчёт.

После брифа 2 на ветке `contracts` добавлены контракты для брифов 3–6 (`docs/contracts/graph-binding.md`, `comfy-job.md`, `agent-request.md`), `run_settings.json` этапа, пустой `prompt.md` у новых кадров.
