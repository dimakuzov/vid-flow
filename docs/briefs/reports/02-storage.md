# Отчёт: бриф 2, хранилище и явный эпизод

Ветка `storage` (от `stage-state`).

## Сделано
- **Эпизод — параметр.** Все функции `src/lib/series/*` и `queueStageRun` получают `episodeId` первым аргументом (или полем в опциях). `getSeriesRoot()`, `episodeDir()`, `resolveEpisodeRoot()`, `ensureEpisode()`, `ensureSeriesScaffold()`, `listSeriesShotIds()` удалены. Полный список сигнатур — `docs/contracts/stage-folder.md`, раздел «Эпизод — всегда явный параметр».
- `current_episode.txt` пишет только `POST /api/series/episode`. `createEpisode()` его не меняет (раньше импорт сценария и отправка на разметку переключали открытый эпизод для всех).
- **Фоновый цикл** (`reconcileAllStages`) обходит все эпизоды. Запрос агенту в неоткрытом эпизоде уходит в Comfy (проверено вживую: открыт `t02`, задание из `t01` встало в очередь).
- В `agent_request.json` и в задании очереди (`ComfyJob`) записан `episodeId` (в задании ещё `shotId`, `stageId`).
- **API** перенесён под `/api/episodes/{ep}/shots/{shot}/...` (`git mv`, история сохранена); добавлен `GET /api/episodes/{ep}`. `/api/shots/**` больше нет. Параметры пути проверяет `src/lib/series/route-params.ts`.
- **Медиа.** URL строится от `data/`: `/api/media/episodes/<ep>/...` и `/api/media/{characters,locations,references}/...`. Проверка пути — `resolveMediaPath` с разделителем (`isInside`), `e010` при `e01` больше не проходит; `comfy_queue/` и файлы в корне `data/` закрыты.
- **Чтение без записей.** `scanSeries()` больше не мигрирует раскладку, не пишет `show.md` и болванки эпизода. Это делает `prepareDataRoot()` при старте (`src/instrumentation.ts`, `scripts/*.ts`). История промпта при чтении этапа осталась.
- Тесты: `src/lib/series/storage.test.ts` — `parseScenario`, `approveFiles` для персонажей (имена файлов → слоты), `deriveStageStatus` с фазой, разные эпизоды с одинаковым кадром, пути медиа, «scanSeries ничего не пишет», фоновый цикл по неоткрытому эпизоду. Тест брифа 1 переведён на новые сигнатуры. Всего 18 тестов, `npm test` зелёный, `tsc --noEmit` чистый, `eslint src/lib src/app/api` чистый.
- Проверено в браузере на временной `DATA_ROOT`: таблица, страница этапа, картинка из `refs/`, отправка агенту, отмена, «Запустить»/«Отменить» из меню клетки.

## Правки в чужих файлах (только аргументы и URL)
- `src/lib/comfy/stage-run.ts`, `src/lib/comfy/queue.ts` (поля `episodeId/shotId/stageId` в `ComfyJob`), `src/instrumentation.ts`, `scripts/comfy-queue.ts` (вызов `prepareDataRoot`).
- `src/lib/series/agent-request.ts`, `agent-dispatch.ts`, `format-request.ts`.
- `src/app/page.tsx`, `src/app/shots/[shotId]/[stage]/page.tsx` (эпизод пока берётся из `current_episode.txt`), `src/components/stage/stage-workspace.tsx` (`shotApi`/`stageApi` от `detail.episodeId`), `src/components/board/stage-cell.tsx` (проп `episodeId`), `series-board.tsx`, `bootstrap-panel.tsx`.

## Риски
- Страница этапа `/shots/{shot}/{stage}` всё ещё показывает открытый эпизод. Ссылка, открытая после переключения эпизода в шапке, покажет кадр другого эпизода. Перенос в URL — бриф 6.
- Старые `agent_request.json` без `episodeId` работают (цикл читает только `id` и `status`).
- `.next/dev/types` после переноса маршрутов устаревают до следующего `next dev`; `tsc` до этого ругается на `src/app/api/shots/...`. Лечится запуском `npm run dev` или `npx next typegen`.

## Предложение
- `data-backup/` (80 файлов старой раскладки) лежит в git. Предлагаю удалить из репозитория (`git rm -r --cached data-backup` и добавить в `.gitignore`), если копия есть на диске. Сам не удалял.

## Нужно от других модулей
- Модуль 6: эпизод в URL страниц (`/e/{ep}/...`), `SeriesBoard` должен читать `GET /api/episodes/{ep}` вместо `/api/series`.
- Модуль 5: `AGENTS.md`, `docs/AGENT_BOOTSTRAP.md` — `SERIES_ROOT` описан как «текущий эпизод»; маршруты кадров теперь под `/api/episodes/{ep}`.
