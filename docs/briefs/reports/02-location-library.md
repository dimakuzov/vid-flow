# Отчёт 02. Локация из библиотеки и граф Krea 2

Ветка `r2-location-library`, worktree `../vid-flow-r2-location`, основа `bulk-actions` (бриф 01 уже в ней).

## Что сделано

### Локация из библиотеки

- `src/lib/series/library.ts`:
  - `listLibraryLocations()` — папки `data/locations/` по имени, миниатюра `view.png`, иначе первая картинка без «copy» в имени. Пропускаются `_old`, `*_old` и скрытые папки.
  - `copyLocationToRefs()` — общий вид → `refs/{locationId}_view{ext}` (у `view.png` это `{locationId}_view.png`). Существующий файл не затирается (ответ «уже есть в refs/»). Новый файл пишет `agent_touch.json` (`refsTouchedByUser: true`). Id локации — только имя существующей папки внутри `data/locations/`: `..`, слэши, `_old`, отсутствующая папка — ошибка.
  - Галка «записать в кадр»: меняет только строку `- location:` в `shot.md`, остальной текст файла остаётся. Если такой строки нет — `readShotMeta` + `writeShotMeta`. `shot-meta.ts` не тронут. (`writeShotMeta` переписывает файл целиком и теряет свои разделы, поэтому он только запасной путь.)
- `GET /api/library/locations` → `{ locations: [{ id, thumbnail }] }`, `thumbnail` — путь для `/api/media/`.
- `POST /api/episodes/{ep}/shots/{shot}/stages/{stage}/refs-from-library`, тело `{ locationId, writeToShot? }` → `{ message, savedAs, stage }`.
- `src/components/stage/location-library.tsx` — кнопка «Из библиотеки» со всплывающим списком (миниатюра + имя, галка «Записать в кадр»), закрывается по Esc и клику мимо.
- `stage-workspace.tsx`: импорт и одна строка под заголовком «Референсы», только при `stageId === "location"`. После выбора страница получает новый `StageDetail` (`stage.merge`): файл сразу в «Референсы» и во входах этапа.

### Граф Krea 2

Пользователь приложил граф в формате API (`The_dining_room.json`), поэтому он сразу лёг в `workflows/comfy/`, а не в черновики:

- `playbooks/workflows/comfy/location_krea2_api.json` — граф без изменений.
- `playbooks/workflows/comfy/location_krea2.bind.json` — этап `location`, `order` 20, «Локация с нуля: Krea 2 по тексту»:
  - `view` — `refs/`, иначе `library:location`, `pick: first`, **`min: 0`**. Нет картинки — удаляются нода `67` (LoadImage) и `66.image1`: чистый text-to-image.
  - `text` — весь `prompt.md` → `61.value`, без шагов и шаблонов.
  - `49.aspect_ratio` = `9:16 (Portrait Widescreen)` (`const`), `54.seed` — случайный, `29.filename_prefix` = `frameboard/location/{shotId}_krea2`.
- Плейбук модели `playbooks/models/krea2_location.md` / `.en.md`: ноды графа, «картинка — смысл, а не пиксели», шаблон `prompt.md`, что работает, чего избегать, пример пользователя (столовая) и черновик советской кухни, 10 источников (официальные Krea: README и `docs/prompting.md`, `expansion.txt`, технический отчёт, блог; fal.ai; ComfyUI Wiki и др.).
- `playbooks/stages/location.md` / `.en.md`: разделы «Какой граф» (`location_views` против `location_krea2`) и «Локация из библиотеки».
- `playbooks/workflows/comfy/README.md` — строка `location_krea2`. `playbooks/workflows/drafts/README.md` — как пересохранить граф (ниже то же).

Вариант по умолчанию следует из контракта: есть общий вид (refs/ или библиотека) — `location_views` (order 10), нет — `location_krea2` (ему картинка не обязательна). Проверено тестом и в браузере.

## Инструкция пользователю: экспорт графа Krea 2

Текущий граф уже на месте. Если поменяешь его в ComfyUI:

1. Открой граф Krea 2 в ComfyUI, убедись, что прогон проходит.
2. Доска пишет в эти ноды (id сейчас):

   | id | Тип | Поле |
   | --- | --- | --- |
   | `61` | `PrimitiveStringMultiline` | `value` — весь `prompt.md` |
   | `66` | `TextEncodeQwenImageEditPlus` | `image1` — убирается, если картинки нет |
   | `67` | `LoadImage` | `image` — первый файл `refs/` или общий вид из библиотеки |
   | `49` | `ResolutionSelector` | `aspect_ratio` |
   | `54` | `KSampler` | `seed` |
   | `29` | `SaveImage` | `filename_prefix` |

   LoRA (`60`, `65`), переключатель `63`, шаги, cfg и сэмплер доска не трогает.
3. **Workflow → Export (API)** (старый интерфейс: включить Dev mode в настройках → **Save (API Format)**), имя `location_krea2_api.json`.
4. Положить в `playbooks/workflows/comfy/` вместо старого.
5. Если id нод поменялись — поправить `node` в `location_krea2.bind.json`.
6. `npm test` — тест манифестов назовёт пропавшую ноду или поле.

## Что проверено

- `npm test` — 111 тестов, 0 ошибок. Новый `src/lib/series/library.test.ts` (7 тестов): список (миниатюра, `_old` и «copy» пропущены, папка без картинки), копирование (имя, расширение, `agent_touch.json`), без затирания (и без отметки), отказ на `..`, `\`, `_old`, несуществующую и пустую папку, чужой `shotId`; «записать в кадр» сохраняет остальной `shot.md`; выбранный файл — первый вход графа; сборка задания Krea 2 без картинки (нода `67` и `image1` убраны, 9:16, seed, префикс, вариант по умолчанию) и с картинкой (`Kitchen_view.png` в `67`, умолчание переключается на `location_views`). Тест манифестов `graph-binding.test.ts` проходит на новом манифесте.
- `npx tsc --noEmit` (после `npx next typegen` в новом worktree), `npx eslint src scripts` — чисто.
- Браузер, порт 3472, `DATA_ROOT=$TEMP/frameboard-r2-location`, `COMFY_URL=http://127.0.0.1:9`, в `locations/` — `Kitchen`, `Stairwell`, `Kitchen_old`: кнопка есть на «Локации», нет на «Первом кадре» и «Видео»; в списке две локации с миниатюрами, `Kitchen_old` нет; выбор Kitchen с галкой → `refs/Kitchen_view.png`, сообщение, файл сразу в «Референсы» и во входах этапа, `shot.md` → `- location: Kitchen`, `agent_touch.json` записан; повторный выбор не затирает. Ошибок в консоли нет.
- В ComfyUI ничего не отправлялось.

## Риски

- Граф в ComfyUI через доску не прогонялся (по правилам — без согласия). Строку `9:16 (Portrait Widescreen)` я взял из документации ComfyUI для `ResolutionSelector`; в графе у ноды есть поле `multiple`, которого в документации нет, — версия ноды может быть новее. Если ComfyUI отклонит значение, убрать слот `49` из манифеста и поставить 9:16 в самом графе.
- Влияние картинки через `TextEncodeQwenImageEditPlus` на Krea 2 официально не описано; в плейбуке оно описано как «смысловой референс» по отчёту Krea (Qwen3-VL принимает текст и картинку) и обзорам. Комнату Krea 2 не сохраняет.
- В графе LoRA `krea2_darkbrush` 0.5 (стиль «monochrome ink wash») — так у пользователя; на фотореализм может влиять. Доска её не трогает.
- Миниатюры — полные файлы через `/api/media/` (без уменьшения). На 9 локациях это нормально.
- `binding.ts` (`library:location`) не пропускает папку `_old`, но берёт локацию только по имени из `shot.md`, так что это не важно.

## Нужно от других

- `src/lib/series/scanner.ts` (бриф 03), около строки 205: в список «Playbooks» этапа `location` добавить `models/krea2_location.md` и `.en.md` — сейчас там только `qwen_location`. Не правил, файл чужой.
