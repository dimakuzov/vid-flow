# Бриф 1. Единое состояние этапа (делается первым, один агент)

Сначала прочитай `docs/briefs/00-overview.md`. Эта задача проходит через все модули сразу, поэтому её делает один агент целиком, до остальных брифов. Здесь ты правишь файлы любых модулей, но только в объёме этой задачи.

## Что не так сейчас
- Статус этапа складывается из трёх источников: папки (`output/`, `approve/`), `status.json` (пишут UI, approve, очередь Comfy) и инструкции агенту ставить `"done"`, которого доска не знает. `deriveStageStatus` уважает из `status.json` только `waiting`.
- Состояние «агент работает / ждёт очереди / в очереди» лежит отдельно в `agent_request.json` и `agent_dispatch.json` и в таблице не видно.
- Клетка после «Отправить агенту» остаётся активной. Можно запустить прогон или отправить повторно, пока агент ещё работает.
- Сообщение пользователя пишется в `llm_notes.md`, а раннер (`src/lib/comfy/stage-run.ts → generationText`) берёт `llm_notes.md` раньше `prompt.md`. Если агент не очистил файл, в модель уходит сырое сообщение вместо переписанного промпта. Очистку сейчас поручают агенту, и иногда она не происходит.

## Как должно быть

**Один писатель.** Фазу этапа пишет только процесс доски (API-маршруты и фоновый цикл), в файл `stage_state.json` папки этапа. Агент статусы не пишет никогда. Его единственный сигнал — `"status": "done"` в `agent_request.json` (или вызов API, если модуль 5 его добавит).

**Фазы:**

| phase | Показ в клетке | Кто ставит | Когда |
|---|---|---|---|
| `idle` | Пусто / Подготовка (по файлам, как сейчас) | — | нет активной операции |
| `agent` | Агент обрабатывает | API agent-request | нажата «Отправить агенту» |
| `queued` | Ожидает очереди | цикл dispatch / API run | задание записано в `data/comfy_queue`, в ComfyUI ещё не принято (в том числе если ComfyUI выключен) |
| `running` | В очереди ComfyUI / генерация | очередь Comfy | ComfyUI вернул `prompt_id` |
| `review` | На проверке | очередь Comfy / загрузка файла | файлы легли в `output/` |
| `approved` | Утверждено | approve | файл в `approve/` |
| `error` | Ошибка + текст | любой шаг | агент/очередь/ComfyUI упали |

Поля: `phase`, `since`, `requestId`, `jobId`, `error`, `updatedAt`. `review`/`approved`/`idle` можно продолжать выводить из папок. Активные фазы (`agent`, `queued`, `running`, `error`) берутся только из `stage_state.json` и перекрывают вывод из папок.

**Блокировка.** Пока фаза `agent`, `queued` или `running`, в клетке и на странице этапа недоступны «Отправить агенту» и «Запустить». Доступна «Отменить»: возвращает `idle`, помечает запрос `cancelled`, а задание в очереди, если ещё не ушло в ComfyUI, — `cancelled`. Без отмены зависший агент навсегда заблокирует клетку. Добавь также таймаут: если агент не ответил за N минут (константа), фаза `error` с текстом «агент не ответил».

**Сообщение пользователя.** При «Отправить агенту» доска сама переносит текст в `agent_request.json` и сразу очищает `llm_notes.md`. Раннер Comfy `llm_notes.md` не читает вообще: в модель идёт только `prompt.md`. Убери из шаблонов задач (`agent-request.ts`: `renderRequestMarkdown`, `renderLlmTask`) и из `AGENTS.md` поручение агенту чистить `llm_notes.md`.

**Агентские «done» в статусе этапа.** Убери из `AGENTS.md`, `src/lib/series/agent-request.ts` (шаблоны) и `playbooks/workflows/characters_comfy*.md` указание ставить `status.json` в `done`. Для этапа `characters`, где агент гоняет ComfyUI сам, достаточно `agent_request.json → done`. Доска переводит фазу в `review`, если в `output/` есть файлы.

## Где править
- `src/lib/series/`: новый `stage-state.ts` (чтение/запись/переходы), `status.ts` (сведение фазы и вывода из папок), `types.ts` (`StageSummary.phase`, `StageDetail.state`), `mutations.ts` (approve, upload), `agent-request.ts` (отправка, отмена, шаблоны), `agent-dispatch.ts` (переход `agent → queued`, таймаут).
- `src/lib/comfy/queue.ts`: переходы `queued → running → review/error` вместо `markStageReview`. Пиши в стадию по `episodeId`, сохранённому в задании, а не по текущему эпизоду (см. бриф 2, п. 1). Минимально: добавь `episodeId`, `shotId`, `stageId` в `ComfyJob` при постановке в `stage-run.ts`.
- `src/app/api/...`: маршрут отмены.
- `src/components/board/stage-cell.tsx`, `status-pill.tsx`, `src/components/stage/stage-workspace.tsx`: показ фазы, блокировка кнопок, «Отменить». Большой рефакторинг UI не делай, он в брифе 6.
- `docs/contracts/stage-folder.md`: опиши `stage_state.json`, фазы и кто какой файл пишет.

## Проверка
Временная папка `DATA_ROOT`, один кадр. Пройди руками: отправить агенту → клетка заблокирована → вручную поставить `done` в `agent_request.json` → фаза `queued` → (ComfyUI выключен) остаётся `queued` → отмена → `idle`. Тесты `node --test` на переходы. `npx tsc --noEmit` без новых ошибок.
