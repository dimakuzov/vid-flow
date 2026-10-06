# Бриф 4. Воркфлоу и плейбуки

Сначала прочитай `docs/briefs/00-overview.md`, затем `docs/contracts/graph-binding.md`.

Ветка `b4-playbooks`, worktree `../vid-flow-playbooks`. Код не запускаешь, ComfyUI не запускаешь (если пользователь не попросит).

## Твои файлы (правишь только их)

- `playbooks/**`: плейбуки (`stages/`, `models/`, `workflows/`), графы `workflows/comfy/*.json`, манифесты `workflows/comfy/*.bind.json`, `README.md` внутри `playbooks/`.

Не трогаешь: `src/**`, `AGENTS.md`, `docs/contracts/**`. Можно читать `src/lib/comfy/stage-run.ts` и `src/lib/series/agent-request.ts`, чтобы видеть, что код берёт из плейбуков.

## Что уже есть

| Этап | Граф (API) | Манифест | Кто запускает |
|---|---|---|---|
| characters | нет API-графа одежды; `character_pose_outfit_qwen.json` — только поза | — | агент по `workflows/characters_comfy.md` |
| location | `location_views_multiple_angles.json` | `location_views.bind.json` | доска |
| first_frame | `qwen21_character_compositing.json` | `first_frame_compositing.bind.json` | доска (нужны approve локации и персонажей) |
| first_frame без персонажей и локации | нет | — | никто |
| video_preview | `wan22_i2v_sketch_turbo_api.json`, `wan22_flf_sketch_turbo_api.json` | `video_i2v`, `video_flf` | доска |
| final_render | те же графы | `final_i2v`, `final_flf` (временные) | доска |

- Формат манифеста и правила выбора варианта — `docs/contracts/graph-binding.md`. Проверка: `npm test` (`src/lib/contracts/graph-binding.test.ts`) падает, если нода или поле манифеста пропали из графа, `id` не совпадает с именем файла, `playbook` не существует, повторяется `order`.
- Новые кадры получают **пустой** `prompt.md`. `prompt.md` — ровно текст для модели, на её языке. Инструкция этапа живёт в плейбуке. Действие кадра — в `shot.md`.
- Агент статус этапа не пишет и `llm_notes.md` не чистит (бриф 1). Сигнал — только `done` в `agent_request.json`.

## Задачи

1. **Одежда персонажа — граф доски.** Подготовь пользователю точную инструкцию: какой воркфлоу открыть в ComfyUI, какие ноды должны быть, как сохранить в формате API (`character_outfit_qwen21.json`). Напиши манифест `character_outfit.bind.json` (входы: база персонажа, референс одежды из `refs/`; текст; seed; префикс) — с пометкой в отчёте, что node id проверить после экспорта. Пока графа нет, манифест не клади в `workflows/comfy/` (тест упадёт) — положи черновик в `playbooks/workflows/drafts/`. Граф позы со скелетом остаётся отдельным, по явной просьбе.
2. **Первый кадр без персонажей и локации.** Предложи граф (text-to-image или edit по `refs/`), инструкцию экспорта и черновик манифеста `first_frame_text` (order 20) — так же в `drafts/`, если графа ещё нет.
3. **Финал.** Реши и запиши в `stages/final_render.md`: модель, разрешение, апскейл/интерполяция — или явно «финал пока = превью». `models/minimax_video.md` и `stages/final_render.md` сейчас — заглушки.
4. **Шаблоны `prompt.md`.** Для каждого манифеста — раздел в `models/<...>.en.md` (+ русская версия): точный шаблон текста для модели, пример, ограничения (язык, длина, что нельзя). Это читает агент в text-режиме (поле `playbook` манифеста) — пиши так, чтобы по нему одним запросом к LLM получался готовый `prompt.md`. Отметь, какие обвязки из `steps`/`templates` манифестов можно перенести в шаблон (и тогда упростить манифест в том же коммите, `npm test` зелёный). Создай `models/wan_video.en.md` (сейчас есть только русская) и поправь `playbook` в видео-манифестах.
5. **Правило выбора варианта.** Для этапов с несколькими вариантами (видео i2v/FLF; персонаж по референсу / по тексту / с позой) — в `stages/<stage>.en.md` и русской версии: когда какой вариант; агент может предложить другой через `suggestedWorkflow` (`docs/contracts/agent-request.md`).
6. **Критерии приёмки** в `stages/<stage>.md`: что считать хорошим результатом этапа.
7. **RU + `.en.md`.** Сверь пары, допиши отставшие по смыслу. Запиши правило в `playbooks/README.md`.
8. **Устаревшее.** `workflows/comfy/README.md` («Frameboard граф не запускает») — переписать таблицей «этап → граф → манифест → кто запускает» и описанием ручной проверки после пересохранения графа (`npm test`). Модели в `characters_comfy.md` против JSON графа позы («bf16 UNET name… not on this machine») — привести к установленным или вынести в список «проверить вручную».
9. **Статусы.** Убедись, что ни в одном плейбуке не осталось указаний писать `status.json`, `stage_state.json`, чистить `llm_notes.md` или фильтровать `prompt.md`.
10. **Метаданные видео.** Проверь по графам, пишет ли нода сохранения видео воркфлоу в файл; если нет — опиши, что поменять в ComfyUI.

## Результат

- Для каждого этапа: граф (или черновик + инструкция экспорта), манифест, `models/*.md` + `.en.md` с шаблоном текста, `stages/*.md` + `.en.md` с критериями и правилом выбора.
- Обновлённые `playbooks/README.md` и `workflows/comfy/README.md`.
- Отчёт `docs/briefs/reports/04-workflows.md`: список ручных проверок в ComfyUI для пользователя; предложения для `AGENTS.md` (модуль 5).
- `npm test` зелёный.
