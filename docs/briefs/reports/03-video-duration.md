# Отчёт 03. Видео (превью): длительность клипа

Ветка `r2-video-duration` (от `bulk-actions`, где уже смержен 01), worktree `../vid-flow-r2-duration`.

## Что сделано

- **Контракт.** У числового входа новый источник `from: "settings:seconds"` — `durationSec` из `run_settings.json` — и запасной `fallback: "prompt:seconds"`. Порядок: меню → `N sec` из `prompt.md` → значение графа. Выбран вариант «отдельный источник с запасным»: старые манифесты (`prompt:seconds`, `media:duration`, все `final_*`) работают как раньше, а порядок виден в самом манифесте. Для `settings:seconds` `min`/`max` обязательны (целые, `min <= max`), `fallback` у других источников — ошибка манифеста. Тип `DurationRange` в `src/lib/contracts/graph-binding.ts`. Описание — `docs/contracts/graph-binding.md`, раздел «Длительность из меню: `settings:seconds`».
- **Манифесты** `video_i2v`, `video_flf`: вход `seconds` → `settings:seconds` + `fallback: prompt:seconds`, 2–8, подпись «Длительность клипа». Нода та же (`129:161`, `Float (Duration)`). `final_*` не тронуты.
- **`binding.ts`.** `buildPrompt` читает `durationSec` из `run_settings.json`; выбор вне `min..max` манифеста не считается выбором. Новые `settingsSecondsInput`, `durationRange(binding, graph, ctx)` (по умолчанию — секунды из `prompt.md`, иначе значение графа в первом target) и `stageDuration(ctx, workflowId)` (меню + действующий выбор) — их используют scanner, PATCH и задача агенту, чтобы правило было одно.
- **`run_settings.json`.** Поле `durationSec`. Новая `updateRunSettings` меняет только переданные поля: раньше `PATCH runWorkflow` переписывал файл целиком и стёр бы длительность.
- **`StageDetail`**: `durationSec: number | null`, `durationRange: { min, max, default } | null` — для воркфлоу, который уйдёт в запуск (выбор этапа или вариант по умолчанию; устаревший id → по умолчанию). Хелпер `effectiveWorkflowId` в `scanner.ts`.
- **PATCH** `.../stages/{stage}`: поле `runDuration` — целое (число или строка из селекта), `""`/`null` — сброс. Не целое, вне `min..max`, у воркфлоу нет меню — 400, файл не меняется. Если в том же PATCH есть `runWorkflow`, диапазон берётся у нового воркфлоу.
- **UI** (`workflow-menu.tsx`): `DurationMenu` под селектом воркфлоу — «По умолчанию (N с)», затем 2 с … 8 с. Выключено вместе с меню воркфлоу, пока этап занят. Без `durationRange` не показывается (характеры, локация, первый кадр, финал).
- **Агенту.** `llm_task.md`, раздел «Воркфлоу этапа»: «Длительность клипа: N с. Действие должно уложиться в это время. Длительность доска ставит сама: `N sec` в prompt.md не пиши.» Text-режим (`AgentTask.user`, блок кадра): `- clip duration: N s, chosen by the user in the board menu. The action must fit into this time. The board sets the duration itself: do not write "N sec" in prompt.md.` Строки нет, если выбрано «По умолчанию».
- **Плейбук** `wan_video.md` / `.en.md`, раздел 8, правило 7: если длительность выбрана в меню, `N sec` не писать, темп действия — под эту длительность; иначе как раньше.

### Отступления от брифа

- В text-режиме строка длительности по-английски, а не «Длительность клипа: N с…»: весь `AgentTask.user` и плейбук модели английские (правило «`.en.md` читает агент»). В `llm_task.md` строка ровно как в брифе.
- Правки в файлах вне списка брифа (без них меню не работает или строка не попадает в `llm_task.md`). Все — короткие и не пересекаются с правкой 02:
  - `src/components/stage/stage-workspace.tsx`: функция `chooseDuration` (PATCH `runDuration`) рядом с `chooseWorkflow` и два пропа у `<WorkflowMenu>` (`duration`, `onDuration`). Строку 02 у «Референсы» не трогал.
  - `src/components/board/stage-cell.tsx`: то же для меню в ячейке таблицы.
  - `src/lib/series/agent-request.ts`: функция `renderDuration` и одна строка вызова в `renderLlmTask` после списка воркфлоу. Этот файл ни в одном брифе раунда 2 не значится.

## Что проверено

- `npm test` — 108/108. Новые тесты в `src/lib/comfy/duration.test.ts` (5), на настоящих манифестах и графах Wan из `playbooks/`, данные во временной папке:
  - сборка: нет выбора и `N sec` → 5 (граф), `… 3 sec` → 3, `durationSec: 4` → 4 (и для `video_flf`), `durationSec: 12` → 3 (вне диапазона — запасной);
  - `durationRange`: `{2, 8, 5}`, с `6 sec` в prompt.md — `default: 6`; у манифеста с `prompt:seconds` — `null`; ошибки манифеста (нет min/max, `fallback` не у того источника);
  - PATCH: 4 → `durationSec: 4`, `workflow` сохраняется; смена воркфлоу не сбрасывает длительность; 9, 1, `"abc"`, 4.5 → 400 «вне 2–8», файл не изменён; `"6"` → 6; `""` → сброс; `first_frame` → 400;
  - `queueStageRun` → в задании очереди `129:161 = 4`;
  - задача агенту: без выбора строки нет, с `durationSec: 3` — есть в `buildTextParts().user` и в `llm_task.md`.
- `npx tsc --noEmit`, `npx eslint src scripts` — без ошибок (в свежем worktree сначала `npx next typegen`).
- Браузер, порт 3473, `DATA_ROOT=$TEMP/frameboard-r2-duration`, `COMFY_URL=http://127.0.0.1:9`: на `s01 · Видео (превью)` под воркфлоу — «Длительность клипа: По умолчанию (5 с)»; выбор 4 с → `run_settings.json` `{ "durationSec": 4 }`; «Запустить» → `comfy_queue/s01-video_i2v-….json`, `pending`, `129:161 = 4`; пока задание в очереди, оба селекта выключены. ComfyUI не вызывался.

## Риски

- Выбор хранится один на этап, а не на воркфлоу. Если у другого воркфлоу будет другой диапазон, выбор вне него молча считается «по умолчанию» (меню это покажет).
- `durationRange.default` зависит от `prompt.md` и меняется, когда агент переписывает промпт. Это «как сейчас», но подпись «По умолчанию (N с)» может сдвигаться после ответа агента.
- Старые `prompt.md` с `N sec` в конце: при выбранной в меню длительности `N sec` всё равно уходит в модель как текст (граф получает выбранное). Агент при следующем проходе его уберёт по правилу 7; вручную — удалить два слова.
- `stageDuration` читает манифест (кэш по mtime) и `prompt.md` на каждом `getStageDetail` — нагрузка небольшая.

## Нужно от других

- 01, 02: при слиянии `stage-workspace.tsx` — у `<WorkflowMenu>` два новых пропа и функция `chooseDuration`; конфликтов с вставкой 02 у «Референсы» не жду.
- 04: при слиянии `agent-request.ts` (если 04 его трогает) — сохранить вызов `renderDuration(...)` после `renderWorkflows(...)`.
- Плейбуки (модуль 4): новый видео-манифест с меню длительности — вход `settings:seconds` с `min`/`max`, без правки кода.
