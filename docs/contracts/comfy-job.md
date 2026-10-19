# Контракт: задание очереди ComfyUI

Типы: `src/lib/contracts/comfy-job.ts` (`ComfyJob`, `JobSummary`). Владелец кода очереди — модуль 3.

Файл: `data/comfy_queue/<id>.json`. `id`: латиница, цифры, `.`, `_`, `-`, до 81 символа. Рядом временный `<id>.lock` (pid процесса, который сейчас работает с заданием).

## Поля и кто пишет

| Поле | Пишет | Когда |
|---|---|---|
| `id`, `prompt`, `uploads`, `saveTo` | постановщик (`queueStageRun`, агент на `characters`, `POST /api/comfy/queue`) | при постановке |
| `episodeId`, `shotId`, `stageId`, `workflow` | постановщик доски | при постановке. У ручных заданий могут отсутствовать |
| `status: pending`, `queuedAt` | `enqueueComfyJob` | при постановке |
| `status: running`, `promptId`, `submittedAt` | очередь | ComfyUI принял `POST /prompt` |
| `queuePosition` | очередь | каждый проход по `GET /queue`: 0 — выполняется, 1.. — ждёт; `null` — неизвестно |
| `lostAt`, `restarts` | очередь | ComfyUI отвечает, а задания нет ни в его очереди, ни в истории (ComfyUI или компьютер перезапускались): `lostAt` — с какого момента. Через минуту задание снова `pending` без `promptId`, `restarts` + 1, и следующий проход отправляет его заново. После двух повторов — `error`. Пока ComfyUI не отвечает, задание ждёт |
| `status: done`, `files`, `finishedAt` | очередь | файлы скачаны в `saveTo` |
| `status: error`, `error`, `nodeErrors`, `finishedAt` | очередь | ComfyUI отказал или упал |
| `status: cancelled`, `finishedAt` | `cancelComfyJob` (кнопка «Отменить») | в любой момент до `done/error` |
| `updatedAt` | любой писатель | при каждой записи |

Никто, кроме перечисленных, файл не меняет. Этап (`stage_state.json`) ссылается на задание по `jobId`; статус этапа очередь не пишет.

## Статусы

```
pending ──claim──> running (без promptId) ──POST /prompt──> running (promptId) ──history──> done
   ^                    │ ComfyUI недоступен                     │ отказ / ошибка          
   └────────────────────┘                                         └──────────────────────> error
pending / running ──«Отменить»──> cancelled   (prompt снимается из ComfyUI: /queue delete, /interrupt)
```

- ComfyUI выключен — задание остаётся `pending` без ошибки. Этап показывает «Ожидает очереди».
- `cancelled` финальный: очередь перечитывает файл до и после `POST /prompt` и не затирает отмену (тест `src/lib/comfy/queue.test.ts`).
- `running` без `promptId` дольше 20 минут с мёртвым `.lock` — снова берётся в работу.

## `uploads` и `saveTo`

- Пути — от cwd (корень репо), должны лежать внутри `data/` или `playbooks/` (uploads) и внутри `data/` (`saveTo`). Иначе задание не ставится.
- `uploads[].filename` — имя в ComfyUI (`/upload/image`, `overwrite: true`).

## Файлы результата

- `saveText: true` — сохранить и текстовые выходы нод (`outputs[node].text`, например `PreviewAny`) как `{node}.txt` (только локальный ComfyUI). Нужно графам без картинок: распознавание речи Whisper для поста (`docs/contracts/post.md`).

- Сохраняются в `saveTo` байт в байт (без перекодирования): PNG сохраняет метаданные с воркфлоу и seed.
- **Имена уникальные**: существующий файл в `saveTo` не затирается; при совпадении добавляется суффикс (формат выбирает модуль 3). Итоговые имена — в `files`.

## Ошибки

`error` — одна строка для пользователя. `nodeErrors` — по ноде: `{ node, classType, message }`, текст человеческий (из `node_errors[...].errors[].message/details`), а не JSON.

## Что видит интерфейс

`StageDetail.job: JobSummary | null` — последнее задание этапа (`stage_state.jobId`), читается `readJobSummary()` без записи. Поля: `status`, `workflow`, `queuedAt`, `submittedAt`, `finishedAt`, `queuePosition`, `files`, `error`, `nodeErrors`.

Фазу клетки берите из `StageDetail.state.phase` / `StageSummary.status`, а не из `job.status`: `running` без `submittedAt` — очередь только пытается отправить, для пользователя это ещё «Ожидает очереди».

## Процесс

Очередь и цикл агента работают внутри процесса Next (`src/instrumentation.ts` → `src/lib/background.ts`, один таймер на имя, горячая перезагрузка подменяет функцию цикла). Отдельного воркера нет. `npm run comfy-queue` — отладочный запуск той же очереди без доски; вместе с `npm run dev` не запускать (не сломается из-за `.lock`, но два процесса опрашивают ComfyUI). `FRAMEBOARD_LOOPS=off` выключает циклы (тесты).

`COMFY_URL` — адрес ComfyUI, по умолчанию `http://127.0.0.1:8188`.

## Comfy Cloud (`target: "cloud"`)

Задание с `target: "cloud"` очередь отправляет не в локальный ComfyUI, а в Comfy Cloud (`https://cloud.comfy.org`, API v1, ключ `COMFY_CLOUD_API_KEY` из `.env.local`; `COMFY_CLOUD_URL` — другой адрес, для тестов).

- Отправка: `POST /api/upload/image` для каждого файла `uploads` → облачное имя подставляется во все входы графа с этим именем → `POST /api/prompt` с `extra_data.api_key_comfy_org` (платные ноды, HeyGen). `promptId` — id задания в облаке.
- Опрос: `GET /api/jobs/{id}` не чаще раза в 15 с. `completed` → файлы из `outputs` скачиваются через `GET /api/view` (302 на подписанную ссылку; по ней — без ключа) в `saveTo`. `failed` → `error`. Сбой сети при опросе или скачивании — не ошибка: спросим снова, прогон уже оплачен.
- **Повторной отправки нет.** Любая ошибка до ответа `/api/prompt` — `error`. Задание `running` без `promptId` (доска упала посреди отправки) — `error` «Отправка прервалась… проверьте cloud.comfy.org»: кредиты могли уже списаться, решает пользователь.
- «Отменить» снимает задание из облачной очереди и прерывает его, только если выполняется именно оно.
