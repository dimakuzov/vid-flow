# Бриф 3. Запуск в ComfyUI

Сначала прочитай `docs/briefs/00-overview.md`, затем `docs/contracts/graph-binding.md`, `docs/contracts/comfy-job.md`, `docs/contracts/stage-folder.md`.

Ветка `b3-comfy-runner`, worktree `../vid-flow-comfy`, `DATA_ROOT=$TEMP/frameboard-comfy`, порт 3463, `COMFY_URL=http://127.0.0.1:9`.

## Твои файлы (правишь только их)

- `src/lib/comfy/**` — `client.ts`, `queue.ts`, `stage-run.ts`, `workflows.ts`, `queue.test.ts`, новые файлы (например `binding.ts`, `binding.test.ts`)
- `src/app/api/comfy/**`
- `src/app/api/episodes/[episodeId]/shots/[shotId]/stages/[stage]/run/route.ts`
- `scripts/comfy-queue.ts`
- `package.json` — только раздел `scripts`, если нужно

Не трогаешь: `playbooks/**` (манифесты уже лежат, их сопровождает бриф 4), `src/lib/contracts/**`, `src/lib/background.ts`, `src/instrumentation.ts`, `src/lib/series/**`, `README.md`.

## Что уже есть

- Манифесты для текущих графов: `playbooks/workflows/comfy/{location_views,first_frame_compositing,video_i2v,video_flf,final_i2v,final_flf}.bind.json`. Составлены по нынешнему `stage-run.ts`. `npm test` проверяет, что их ноды и поля есть в графах.
- Типы манифеста: `src/lib/contracts/graph-binding.ts`. Типы задания: `src/lib/contracts/comfy-job.ts` (`ComfyJob` реэкспортируется из `queue.ts`).
- `src/lib/comfy/workflows.ts`: `listWorkflowChoices` и `resolveWorkflowId` с **временным** списком в коде. Сигнатуры зафиксированы: на них опираются `scanner` (меню в UI), PATCH этапа (`runWorkflow`), бриф 5.
- `queueStageRun(episodeId, shotId, stageId, { workflow?, fromAgent? })` уже принимает id манифеста или `i2v`/`flf`, выбор этапа читает из `run_settings.json` (`readRunSettings`).
- Задание уже хранит `episodeId`, `shotId`, `stageId`, `workflow`, `queuedAt`.
- Фоновые циклы: `startComfyQueue()` регистрирует цикл через `registerLoop` (`src/lib/background.ts`) — горячая перезагрузка подменяет функцию. Процесс один — Next. Решение принято, описано в `docs/contracts/comfy-job.md`, раздел «Процесс».

## Задачи

1. **Общий раннер на манифестах.** `stage-run.ts` перестаёт знать node id: «манифест + граф + значения входов → prompt». Загрузка манифестов из `playbooks/workflows/comfy/*.bind.json` (через `getPlaybooksRoot()`), проверка при загрузке: нет ноды/поля → ошибка с именами манифеста, ноды и графа. Реализуй всё из контракта: источники картинок (`refs`, `approve:<stage>`, `library:location`, массив), `pick`, `min/max`, `uploadAs`, текст, `prompt:seconds`, `steps` (`namesTo`, `ensure`), `templates` с `when`, `seed: random` на каждый target, `template`, `whenEmpty.remove`.
2. **`workflows.ts` по манифестам.** Тела `listWorkflowChoices`/`resolveWorkflowId` — из манифестов этапа (по `order`, `available`/`missing` по входам с `min ≥ 1`, текст и число на доступность не влияют, `aliases`, `playbook`). Этап без манифестов → пустой список, `queueStageRun` даёт понятную ошибку (сейчас `characters`). Когда бриф 4 добавит манифест одежды, этап заработает без правки кода.
3. **Текст для модели — только `prompt.md`.** Удали `generationText()` с фильтрами строк и `refusesAngleGraph()`. Всё, что добавляется к тексту, — из манифеста. Старый `prompt.md` с инструкцией доски (строки с `Собери `, `Правила: playbooks/`, `Локация:`, `Персонажи:`) → ошибка «prompt.md содержит инструкцию для агента, а не текст для модели: перепиши его или отправь агенту». Без тихого вырезания.
4. **Сверка до/после.** На тестовом кадре во временной `DATA_ROOT` собери prompt для location, first_frame (1 и 2 персонажа), video i2v/flf, final — старым кодом (сохрани JSON до правки) и новым. Совпадать должно всё, кроме случайных seed. Оформи как тест.
5. **Подробности задания** (`docs/contracts/comfy-job.md`): `submittedAt`, `finishedAt`, `queuePosition` (по `GET /queue` на каждом проходе, пока задание `running`), читаемые `nodeErrors` и короткий `error`, `files`. Эти поля показывает UI (бриф 6) через `StageDetail.job`.
6. **Уникальные имена файлов.** `finishJob` не затирает существующий файл в `saveTo`; байты не перекодируются (метаданные PNG). Итоговые имена — в `files`.
7. **`run/route.ts`**: тело `{ runWorkflow?: string }` (старое `workflow: "i2v"|"flf"` тоже принимать). Ответ как сейчас.
8. **`scripts/comfy-queue.ts`**: оставить как отладочный запуск без доски; в начале вывести предупреждение, что вместе с `npm run dev` его не запускают.

## Проверка

- Тесты: сборка prompt из манифеста (все виды слотов, `whenEmpty`, шаблоны по числу персонажей, ошибка на пропавшую ноду), сверка до/после, очередь с подменённым `fetch` (ComfyUI недоступен → `pending`; `node_errors` → читаемый `nodeErrors`; уникальные имена; `queuePosition`).
- В браузере на порту 3463: «Запустить» на location и video → «Ожидает очереди», в `StageDetail.job` есть `workflow` и `queuedAt`; «Отменить» → свободно.
- `npm test`, `npx tsc --noEmit` чистые. В ComfyUI ничего не отправлять.

## Нужно от других и для других

- Бриф 4 добавляет графы и манифесты (одежда персонажа, первый кадр без персонажей, финал). Если формату не хватает выразительности — не расширяй типы сам, опиши в отчёте.
- `stage_state.json` и фазы этапа не трогаешь: очередь пишет только файл задания.
