# Бриф 03. Видео (превью): длительность клипа

Сначала `docs/briefs/00-overview.md`, затем `docs/contracts/graph-binding.md`, `playbooks/models/wan_video.en.md` (раздел 8). Ветка `r2-video-duration`, worktree `../vid-flow-r2-duration`, порт 3473, `DATA_ROOT=$TEMP/frameboard-r2-duration`, `COMFY_URL=http://127.0.0.1:9`. Начинать после мержа брифа 01.

## Твои файлы

`src/components/stage/workflow-menu.tsx`, `src/lib/series/run-settings.ts`, `src/lib/series/scanner.ts`, `src/lib/series/types.ts`, `src/app/api/episodes/[episodeId]/shots/[shotId]/stages/[stage]/route.ts` (PATCH), `src/lib/comfy/binding.ts`, `src/lib/contracts/graph-binding.ts`, `src/lib/agent/task.ts`, `playbooks/workflows/comfy/{video_i2v,video_flf}.bind.json`, `playbooks/models/wan_video.md` и `.en.md`, `docs/contracts/graph-binding.md`.

## Что нужно пользователю

Под выбором воркфлоу на этапе «Видео (превью)» — выбор длительности клипа. Первый пункт «По умолчанию (N с)» — как сейчас: `N sec` из `prompt.md`, иначе значение графа (5 с). Дальше — секунды на выбор (2–8, как `min/max` входа `seconds` в манифесте; шаг 1). Выбор:
- сохраняется в `run_settings.json` этапа (`durationSec`), как выбор воркфлоу (`PATCH` с полем `runDuration`, пустое — по умолчанию);
- уходит в граф (нода `Float (Duration)`, `129:161`) при запуске;
- уходит агенту: в задаче (`AgentTask.user` в text-режиме и `llm_task.md`) строка «Длительность клипа: N с. Действие должно уложиться в это время». Агент пишет промпт под эту длительность и больше не ставит `N sec` в конец, если длительность выбрана в меню.

## Как сделать

- Контракт: у числового входа новый источник `from: "settings:seconds"` — `durationSec` из `run_settings.json`; если его нет — `prompt:seconds`, если и его нет — значение графа. Можно как отдельный источник с запасным (`fallback: "prompt:seconds"`) — опиши выбор в `docs/contracts/graph-binding.md`. Изменение совместимое: старые манифесты работают как раньше.
- Манифесты `video_i2v`, `video_flf` переводятся на новый источник. `final_*` не трогать (финал H3 берёт длительность из ролика превью).
- `StageDetail.durationSec: number | null` и `StageDetail.durationRange: { min, max, default } | null` (null — у выбранного воркфлоу нет такого входа, меню длительности не показывается).
- `workflow-menu.tsx`: селект длительности под селектом воркфлоу; выключен, пока этап занят.
- `wan_video.md` / `.en.md` (раздел 8, правило 7): если длительность выбрана в меню, `N sec` в промпт не писать; темп действия — под эту длительность.

## Проверка

- Тесты: сборка prompt с `durationSec` (нода 129:161 = выбранное), без него — из `prompt.md`, без обоих — значение графа; `PATCH runDuration` вне `min..max` — 400; задача агенту содержит длительность.
- В браузере на порту 3473: на видео-этапе выбрать 4 с → `run_settings.json` → «Запустить» → в файле задания очереди `129:161 = 4`. ComfyUI не трогать.
- Отчёт `docs/briefs/reports/03-video-duration.md`.
