# Бриф 01. Файлы этапа: удаление, входы, скрытая заметка

Сначала `docs/briefs/00-overview.md`, затем `docs/contracts/stage-folder.md`. Ветка `r2-stage-files`, worktree `../vid-flow-r2-files`, порт 3471, `DATA_ROOT=$TEMP/frameboard-r2-files`, `COMFY_URL=http://127.0.0.1:9`.

## Твои файлы

`src/components/stage/{stage-workspace,ref-files,output-panel,media-card}.tsx`, новый `src/components/stage/stage-inputs.tsx`, `src/lib/series/{mutations,scanner,types}.ts`, новый `src/lib/series/stage-inputs.ts`, новый маршрут `src/app/api/episodes/[episodeId]/shots/[shotId]/stages/[stage]/files/route.ts`, `docs/contracts/stage-folder.md`, `AGENTS.md` (только строка про удаление файлов).

## Что нужно пользователю

1. **Удалить файл из `output/`** — совсем, с диска, чтобы папка не копила мусор. Кнопка на карточке файла (корзина), с подтверждением «Удалить файл … навсегда?». Удалённый файл не уходит в корзину Windows.
2. **Удалить файл из `refs/`** вручную — так же, кнопкой на карточке референса, с подтверждением.
3. **Workflow.md** на странице этапа свернуть, как «Заметка refs.md»: `<details>` с заголовком «Заметка workflow.md (на этот кадр)». Сейчас это всегда открытое поле.
4. **Видеть все входы этапа**, а не только `refs/`. То, что граф возьмёт по умолчанию, должно быть видно на странице этапа, даже если это уже утверждено на другом этапе. Например, на первом кадре — утверждённую локацию и утверждённых персонажей.

## Как сделать

### Удаление
- `deleteStageFile(episodeId, shotId, stageId, folder: "output" | "refs", filename)` в `mutations.ts`. Только имя файла (`path.basename`, без `..`), только внутри папки этапа, только существующий файл. Удаление — `fs.unlinkSync`.
- Если удаляется файл из `refs/`, записать `agent_touch.json` с `refsTouchedByUser: true`, как при загрузке в refs (агент тогда не пересобирает refs).
- Занятый этап (`busy`): удаление из `output/` разрешено, из `refs/` — нет (граф или агент могут как раз читать эти файлы). Ошибка с понятным текстом.
- Маршрут `DELETE .../stages/{stage}/files` с телом `{ folder, filename }` → `StageDetail`.
- `approve/` не трогать: там уже есть «Убрать».
- В `AGENTS.md` правило «Do not delete output/ or approve/ without explicit user confirmation» остаётся; допиши, что удаление кнопкой на доске — это и есть подтверждение пользователя, агенту самому удалять по-прежнему нельзя.

### Входы этапа
- `src/lib/series/stage-inputs.ts`: `stageInputs(episodeId, shotId, stageId): StageInput[]`, где `StageInput = { label: string; source: string; files: MediaFile[] }`.
  - Этап с воркфлоу доски: входы выбранного воркфлоу (`run_settings.json`, иначе по умолчанию) — картинки и видео из манифеста, через `resolveImageInput` из `src/lib/comfy/binding.ts` (только читать, функцию не менять). `source` — понятная подпись: «approve этапа Локация», «refs/ этого этапа», «библиотека data/locations/cafe/».
  - `characters` (воркфлоу доски нет): база каждого персонажа кадра из `data/characters/{name}/` (`full_body.png`, `portrait.png`, `side.png`, если есть) и образцы одежды из `refs/`.
  - Медиа из библиотек отдаются через `/api/media/{characters,locations}/...` (уже есть).
- `StageDetail.inputs: StageInput[]` в `types.ts`, заполнить в `scanner.ts`.
- `stage-inputs.tsx`: блок «Что уйдёт в граф» над «Референсы»: для каждого входа подпись, источник и миниатюры (открываются в лайтбоксе). Только просмотр, удаление — только у файлов `refs/` этого этапа.

## Проверка

- Тесты: удаление из output и refs (файл исчез, `agent_touch.json`, отказ на `..`, отказ для refs у занятого этапа); `stageInputs` для first_frame (локация и персонажи из approve), для video_preview (первый кадр), для characters (база из библиотеки).
- В браузере на порту 3471: удалить файл из output и из refs с подтверждением; workflow.md свёрнут; на первом кадре видны утверждённые локация и персонажи.
- Отчёт `docs/briefs/reports/01-stage-files.md`.
