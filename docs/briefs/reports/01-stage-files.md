# Отчёт 01. Файлы этапа: удаление, входы, скрытая заметка

Ветка `r2-stage-files` (от `bulk-actions`), worktree `../vid-flow-r2-files`.

## Что сделано

- **Удаление из `output/` и `refs/`.** `deleteStageFile(ep, shot, stage, folder, filename)` в `src/lib/series/mutations.ts`, маршрут `DELETE .../stages/{stage}/files` `{ folder, filename }` → `StageDetail`.
  - Только имя файла (`basename === filename`, не `.`/`..`), только внутри папки этапа, только существующий файл. `folder` — только `output` или `refs`.
  - `fs.unlinkSync`, без корзины Windows.
  - `refs/` → `agent_touch.json` с `refsTouchedByUser: true` (общий помощник `markRefsTouched`, им же пользуется загрузка).
  - Занятый этап: `refs/` — ошибка «Этап занят…», `output/` — можно.
  - `output/` опустел, `status.json` был `review` → `prep` (как у «Убрать» в approve).
- **UI.** Корзина (`Trash2Icon`) на карточке `MediaCard` (`onDelete`), вопрос `window.confirm("Удалить файл … навсегда?")`. В `output/` — всегда, пока не идёт действие кнопки; в `refs/` — только когда этап свободен.
- **workflow.md** свёрнут: `<details>` «Заметка workflow.md (на этот кадр)», как «Заметка refs.md».
- **Входы этапа.** `src/lib/series/stage-inputs.ts` → `StageDetail.inputs` (заполняет `getStageDetail`). Блок «Что уйдёт в граф» (`src/components/stage/stage-inputs.tsx`) над «Референсы»: подпись, источник, миниатюры (лайтбокс).
  - Этап с манифестами — входы `image`/`video` выбранного воркфлоу (`run_settings.json`, устаревший id → вариант по умолчанию). Источник определяется через `resolveImageInput` по одному источнику за раз — так видно, какой из `from` сработал; `binding.ts` не менялся.
  - Пустой вход показан с `source: "пусто: …"` (янтарным), чтобы было видно, чего не хватает.
  - `characters` — база персонажа (`full_body.png`, `portrait.png`, `side.png`) из `data/characters/{name}/` (папка без учёта регистра) и «Образцы одежды» из `refs/`.
  - Отступление от брифа: в `StageInput` добавлено поле `fromRefs` — по нему блок показывает корзину только у файлов `refs/` этого этапа.
- Документы: `docs/contracts/stage-folder.md` (разделы «Удаление файлов», «Входы этапа», строки в таблицах модулей и API), `AGENTS.md` (строка про удаление).

## Что проверено

- `npm test` — все тесты проходят, новые в `src/lib/series/stage-files.test.ts` (7): удаление из output, из refs + `agent_touch.json`, отказ на `..`/подпапку/несуществующий файл/`approve`, занятый этап (refs нельзя, output можно), входы first_frame (локация и персонажи из approve), video_preview (пусто → первый кадр), characters (база из библиотеки, нет папки, refs).
- `npx tsc --noEmit`, `npx eslint src scripts` — без ошибок. В свежем worktree перед `tsc` нужен `npx next typegen` (иначе нет `PageProps`).
- Браузер, порт 3471, `DATA_ROOT=$TEMP/frameboard-r2-files`, `COMFY_URL=http://127.0.0.1:9`:
  - first_frame: удалены `ff_v1.png` из output и `pose.png` из refs, вопрос «Удалить файл … навсегда?», файлы исчезли с диска, `agent_touch.json` записан;
  - обе заметки свёрнуты;
  - «Что уйдёт в граф» на первом кадре: утверждённая локация и оба персонажа;
  - characters: база katya из библиотеки, для mark «пусто: нет папки data/characters/mark/», образцы одежды;
  - video_preview с заданием в очереди («Ожидает очереди»): корзины у refs нет, у output есть; API на refs — «Этап занят…»; «Отменить» освободил этап;
  - API: `..` → «Некорректное имя файла», `folder: approve` → «Папка — output или refs».

## Риски

- `window.confirm` — нативный диалог; если когда-нибудь страницу откроют во встраиваемом окне, где диалоги запрещены, удаление тихо не сработает.
- `stageInputs` вызывается на каждый `getStageDetail` (опрос страницы): читает манифесты (кэш по mtime) и папки approve. Нагрузка небольшая, но растёт с числом входов.
- Входы показываются «как при запуске сейчас»: `pick: newest` зависит от mtime, после правки файлов картинка может смениться.

## Нужно от других

- 02 (location-library): если появится новый `ImageSource` (например, выбранная локация из библиотеки), добавить его подпись в `sourceLabel` в `src/lib/series/stage-inputs.ts`, иначе подпись будет сырой.
- 03 (video-duration): правки не нужны; `StageDetail` расширен полем `inputs` — учесть при слиянии `types.ts`/`scanner.ts`.
