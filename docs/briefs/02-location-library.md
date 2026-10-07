# Бриф 02. Локация: выбор из библиотеки и граф Krea 2

Сначала `docs/briefs/00-overview.md`, затем `docs/contracts/graph-binding.md`, `playbooks/stages/location.md`, `playbooks/models/qwen_location.md`. Ветка `r2-location-library`, worktree `../vid-flow-r2-location`, порт 3472, `DATA_ROOT=$TEMP/frameboard-r2-location`, `COMFY_URL=http://127.0.0.1:9`. Начинать после мержа брифа 01.

## Твои файлы

Новые `src/components/stage/location-library.tsx`, `src/lib/series/library.ts`, маршруты `src/app/api/library/locations/route.ts` и `src/app/api/episodes/[episodeId]/shots/[shotId]/stages/[stage]/refs-from-library/route.ts`; **одна вставка** в `src/components/stage/stage-workspace.tsx` (кнопка рядом с заголовком «Референсы», только на этапе `location`); `playbooks/**` для Krea 2.

## Что нужно пользователю

1. **Локация из библиотеки.** Модель, размечая сценарий, может не узнать название локации. Рядом с «Референсы — файлы из refs/» на этапе «Локация» — кнопка «Из библиотеки» со всплывающим списком папок `data/locations/` (у пользователя: Bathroom, City_Street, Kitchen, Lecture_Hall, Lena_Room, Stairwell, University_Hall, University_Red_Hall, University_Yard). У каждой — миниатюра `view.png` (иначе первая картинка без «copy» в имени) и название. Выбор копирует картинку в `refs/` этапа (имя `{locationId}_view.png`, существующий файл не затирать) и отмечает `agent_touch.json` (`refsTouchedByUser: true`). Граф локации берёт первый файл `refs/`, так что выбранная локация сразу станет входом.
   - Дополнительно (по желанию): галка «записать в кадр» — поменять `- location:` в `shot.md` на выбранный id. Если делаешь — через функцию в `library.ts`, `shot-meta.ts` не трогать (используй `readShotMeta` / `writeShotMeta`).
2. **Граф Krea 2 для локации.** Пользователь сам добавит граф ComfyUI (Krea 2) в формате API. Твоя часть:
   - найти в интернете, как писать промпт для Krea 2 (официальная документация Krea, гайды, примеры). Сослаться на источники в плейбуке;
   - плейбук модели `playbooks/models/krea2_location.md` и `.en.md`: шаблон `prompt.md`, что работает, чего избегать, примеры. Формат как у `qwen_location.md`;
   - черновик манифеста `playbooks/workflows/drafts/location_krea2.bind.json` (этап `location`, `order` 20, вход — общий вид из `refs/` / `library:location`, текст из `prompt.md`, seed, префикс) и инструкцию в `playbooks/workflows/drafts/README.md`: что открыть в ComfyUI, какие ноды должны быть, как сохранить в формате API под именем `location_krea2_api.json`, какие node id вписать в манифест. В `workflows/comfy/` манифест переносить только когда граф лежит рядом (тест `src/lib/contracts/graph-binding.test.ts` проверяет ноды);
   - `playbooks/stages/location.md` и `.en.md`: когда выбирать Krea 2, а когда `location_views` (4 ракурса).

## Проверка

- Тесты: список локаций (миниатюра, папки `_old` и файлы с `Copy` пропущены), копирование в refs (имя, без затирания, `agent_touch.json`), отказ на чужой путь.
- В браузере на порту 3472: во временной `DATA_ROOT` две локации в `locations/`; кнопка видна только на этапе «Локация»; выбор кладёт файл в refs, он сразу виден в «Референсы» и во входах этапа (бриф 01).
- Плейбуки ru + en с источниками. Отчёт `docs/briefs/reports/02-location-library.md` — с точной инструкцией пользователю по экспорту графа.
