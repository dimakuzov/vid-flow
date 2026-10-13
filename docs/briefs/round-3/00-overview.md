# Frameboard, раунд 3: обзор и правила

Читать каждому агенту **до** своего брифа и выполнять буквально. Прошлые раунды — `docs/briefs/archive/round-1/` и `docs/briefs/0*.md` (раунд 2): только для справки, не задачи.

## Брифы раунда

| Бриф | Что | Ветка | Папка (worktree) | Порт | `DATA_ROOT` |
|---|---|---|---|---|---|
| `01-characters-locations.md` | Персонажи и локации: персонажи на схему доски, без самовольного аппрува; работа с базами; локации | `r3-characters-locations` | `../vid-flow-r3-chars` | 3481 | `$TEMP/frameboard-r3-chars` |
| `02-video.md` | Видео (превью) и финальный рендер: выбор воркфлоу по задаче, промпт финала из утверждённого эскиза, новые воркфлоу | `r3-video` | `../vid-flow-r3-video` | 3482 | `$TEMP/frameboard-r3-video` |
| `03-ui-edit.md` | Интерфейс: кнопки «добавить референс из…», горячие клавиши, правка изображения (обрезка и правка моделью) | `r3-ui-edit` | `../vid-flow-r3-ui` | 3483 | `$TEMP/frameboard-r3-ui` |
| `04-stats.md` | Статистика работы над клипом | позже, после 01–03 | — | — | — |

01, 02 и 03 идут параллельно. 04 не запускается в этом раунде.

## Как устроена доска (коротко)

```
UI (Next.js, /e/{ep}/...) ──HTTP──> /api/episodes/{ep}/shots/{shot}/stages/{stage}/...  ──> src/lib/series (файлы = правда)
   ├ «Отправить агенту» ──> agent_request.json ──> src/lib/agent (manual / ollama / claude): text — агент пишет prompt.md; agent — агент делает этап сам
   ├ «Запустить» ──> src/lib/comfy (граф + манифест *.bind.json) ──> data/comfy_queue ──> ComfyUI :8188 ──> output/
   └ фоновые циклы (src/lib/background.ts): очередь ComfyUI, связь с агентом, описания утверждённых картинок
```

Обязательно прочитать перед работой:
- `docs/contracts/stage-folder.md`, `graph-binding.md`, `comfy-job.md`, `agent-request.md` (там же разделы «Что агент знает о кадре» и «Модель этапа»);
- `playbooks/README.md` и плейбук своих этапов;
- `AGENTS.md`. **Раздел «Shot watch» и «First useful agent task» к вам не относятся**: вы не агент этапов, вы разработчик доски. Входящие эпизода не читаете и запросы этапов не выполняете.

## Что можно всем

- Работать **только в своём worktree и своей ветке** (таблица выше). Читать любой файл репозитория.
- Править файлы из своего раздела «Файлы» в брифе. Создавать новые файлы внутри своих зон.
- Запускать `npm install`, `npm test`, `npx tsc --noEmit`, `npx eslint src scripts`, свой `next dev` на своём порту с временной `DATA_ROOT`.
- Коммитить в свою ветку, пушить её в `origin` и в конце открыть PR в `main` (`gh pr create`, не черновик). Описание PR — что сделано, зачем, как проверено, риски.

## Что нельзя всем

- **`data/` основной папки — реальный проект пользователя.** Не открывать целиком, ничего там не создавать, не менять, не удалять. Нужен пример — смотреть один-два файла только для чтения, лучше вообще не смотреть: всё проверяется во временной `DATA_ROOT`.
- **Ничего не отправлять в настоящий ComfyUI** (`http://127.0.0.1:8188/`) и никогда в Comfy Cloud. Свой `next dev` и тесты — с `COMFY_URL=http://127.0.0.1:9`. Можно только читать `GET http://127.0.0.1:8188/object_info/<класс>`, чтобы проверить, что ноды графа есть.
- **Не вызывать настоящие модели** (Claude, Ollama) из кода доски. Тесты — с подменой (`overrideAgentProvider`, `overrideClaudeOneShot`) и `FRAMEBOARD_LOOPS=off`. Свой `next dev` — с `FRAMEBOARD_DESCRIBE=off` (иначе фоновый цикл начнёт описывать картинки настоящим claude).
- **Не трогать чужие файлы** (раздел «Кто какие файлы правит» ниже). Нужна правка чужого файла — не делать её, а описать в отчёте в разделе «Нужно от других».
- Не мержить в `main`, не пушить в `main`, не переписывать историю (`--force`), не трогать чужие ветки и worktree, не трогать основную папку `vid-flow` (там работает доска пользователя).
- Не делать того, чего нет в брифе. Пользователь просил явно: **никакой инициативы сверх задачи**. Увидели полезное — запишите в отчёт в «Предложения», но не делайте.
- Не менять поведение, которое бриф не просит менять (статусы этапов, формат файлов этапа, контракты), без строки об этом в отчёте.
- Не удалять файлы `output/` и `approve/` кодом, который сам решает удалить: удаление только по явному действию пользователя (кнопка с подтверждением).

## Общие правила работы

- **Этот Next.js новее ваших знаний**: перед правкой Next-кода прочитать нужное в `node_modules/next/dist/docs/` (см. `AGENTS.md`).
- **Плейбуки**: `.en.md` читает агент этапа, русская версия — для пользователя. Меняете смысл в одной — та же правка во второй, в том же коммите.
- **Манифесты графов**: граф в формате API + `<id>.bind.json` в `playbooks/workflows/comfy/`. Пересохранили граф — обновили манифест в том же коммите. Проверка — `src/lib/contracts/graph-binding.test.ts`.
- **В модель идёт только `prompt.md`**. Статус этапа пишет только доска. Утверждает (кладёт в `approve/`) только пользователь — ни доска сама по себе, ни агент этапа.
- **Язык**: интерфейс, сообщения об ошибках, комментарии в коде и документы — по-русски, как в остальном коде. Тексты для моделей — по-английски.
- **Стиль кода**: как в соседних файлах — короткие функции, комментарий-«зачем» над функцией, без лишних абстракций. Не переформатировать чужой код.
- **Тесты**: новую логику покрывать `node --test` во временной папке (`DATA_ROOT=<tmp>`, `FRAMEBOARD_LOOPS=off`). Образцы — `src/lib/series/shot-context.test.ts`, `src/lib/comfy/ltx.test.ts`, `src/lib/series/storage.test.ts`.
- **Перед сдачей**: `npm test`, `npx tsc --noEmit`, `npx eslint src scripts` — без ошибок; проверка в браузере на своём порту (временная `DATA_ROOT`, тестовые картинки).
- **Коммиты**: `git -c core.fileMode=false commit …`, сообщение по-английски, одна мысль на коммит, в конце строка `Co-Authored-By` по правилам вашей среды.
- **Вопросы пользователю**: если бриф неоднозначен или нужен файл, которого нет (граф, картинка), — спросить пользователя в чате и ждать ответа, а не угадывать. Вопросы, на которые ответа нет, — в отчёт.

## Кто какие файлы правит

| Зона | 01 персонажи и локации | 02 видео | 03 интерфейс и правка |
|---|---|---|---|
| `playbooks/stages/{characters,location}*`, `playbooks/models/{qwen_location,krea2_location,qwen_image}*`, `playbooks/workflows/{characters_comfy,location_comfy}*`, `playbooks/workflows/comfy/{character_*,location_*}`, `playbooks/workflows/drafts/character_outfit.bind.json` | **да** | нет | нет |
| `playbooks/stages/{video_preview,final_render}*`, `playbooks/models/{wan_video,ltx_video,minimax_*,heygen_*}*`, `playbooks/workflows/video_preview_comfy*`, `playbooks/workflows/comfy/{video_*,final_*,wan22_*,ltx*,minimax_*,heygen_*}` | нет | **да** | нет |
| `playbooks/workflows/comfy/edit/**` (новая папка: воркфлоу правки изображения), новый плейбук `playbooks/models/image_edit*` | нет | нет | **да** |
| `src/lib/series/library.ts`, `src/lib/series/bootstrap.ts` (заметки этапов персонажей и локации), `src/lib/series/stage-inputs.ts` (часть `characterInputs`) | **да** | нет | нет |
| `src/lib/comfy/workflows.ts`, `src/components/stage/workflow-menu.tsx` | нет | **да** | нет |
| `src/lib/comfy/binding.ts`, `src/lib/contracts/graph-binding.ts`, `docs/contracts/graph-binding.md` | **общий**: только добавлять новое (свой источник входа, своё поле), не менять существующее поведение; каждый свой кусок — отдельной функцией | **общий**, те же правила | читать; нужна правка — в «Нужно от других» |
| `src/lib/comfy/stage-run.ts`, `src/lib/comfy/queue.ts` | **да** (несколько прогонов на этап — по персонажу) | нет; нужна правка — в отчёт | нет |
| `src/lib/series/agent-request.ts` | только текст `work` для `characters` в `renderLlmTask` | нет | нет |
| `src/components/**` (кроме `workflow-menu.tsx`), `src/app/e/**`, новые маршруты API для референсов и правки, новые модули `src/lib/series/ref-sources.ts`, `src/lib/comfy/edit.ts` | нет | нет | **да** |
| `src/lib/series/mutations.ts` | нет | нет | **да**, только добавлять функции (сохранение обрезанного/правленного файла) |
| `AGENTS.md` | раздел «Characters stage» | нет | нет |
| `docs/contracts/stage-folder.md`, `agent-request.md` | свои разделы | свои разделы | свои разделы |

Общие файлы (`binding.ts`, `graph-binding.ts`, `graph-binding.md`, `types.ts`, `scanner.ts`) почти наверняка дадут конфликт при мерже. Правило: правки в них **маленькие и добавочные**, в конце отчёта — список всех изменённых общих файлов с одной строкой «что и зачем». Кто мержится вторым, сливает основу в свою ветку (`git merge <основа>`), чинит конфликт и заново гоняет тесты.

## Запуск агентов (делает пользователь)

Основа — ветка `first-frame-context-ltx` (PR #6). Если PR #6 уже смержен в `main` — основа `main`.

```bash
git worktree add ../vid-flow-r3-chars -b r3-characters-locations first-frame-context-ltx
git worktree add ../vid-flow-r3-video -b r3-video first-frame-context-ltx
git worktree add ../vid-flow-r3-ui -b r3-ui-edit first-frame-context-ltx
```

В каждом worktree один раз `npm install`. Брифы и этот обзор лежат в основной папке `C:\Users\dimak\Documents\vera\soviet_story\vid-flow\docs\briefs\round-3\` (в ветке их может не быть — читать оттуда).

Свой `next dev` (PowerShell, пример для 01):

```powershell
$env:DATA_ROOT="$env:TEMP\frameboard-r3-chars"; $env:COMFY_URL="http://127.0.0.1:9"; $env:FRAMEBOARD_DESCRIBE="off"; npx next dev -p 3481
```

## Отчёт

В конце — `docs/briefs/round-3/reports/0N-<имя>.md` в своей ветке (образец — `docs/briefs/reports/05-shot-agent.md`):

1. Что сделано (по пунктам брифа).
2. Что проверено (тесты, браузер — шаги).
3. Изменённые общие файлы — по строке.
4. Риски и что не сделано.
5. Нужно от других.
6. Вопросы пользователю.
7. Предложения (не сделанные).

Порядок мержа: 01, 02, 03 — в любом порядке, каждый после `git merge <основа>` и тестов. Мержит пользователь.
