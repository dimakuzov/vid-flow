# Контракт: пост эпизода (озвучка, таймлайн Resolve)

Код: `src/lib/post/`. Секция «Пост» под таблицей кадров: `src/components/board/post-panel.tsx`.

## Папки и файлы

```text
data/characters/{Name}/voice.json        голос персонажа, общий для всех эпизодов
data/episodes/{ep}/post/
  lines.json                             правки реплик доски
  voices/{Character}/v{N}.wav            озвучка персонажа: все его реплики одним файлом
  voices/{Character}/v{N}.json           версия: границы реплик, куски, настройки
  voices/{Character}/v{N}.part{K}.mp3    ответ ElevenLabs как есть (+ .json: request-id, текст, таймстемпы)
  voices/{Character}/current.json        { version, updatedAt } — версия в работе
  manifest.json                          манифест последней сборки таймлайна
  timeline/{ep}_v{N}.fcpxml              таймлайны, старые не затираются (рядом .kdenlive той же сборки)
  speech/{shotId}.json                   распознавание речи финала: какой финал, какое задание очереди
  speech/{shotId}/{jobId}/*.txt          выходы Whisper (слова и фразы, JSON)
  jobs/voice-*.json                      задания озвучки
```

| Файл | Пишет | Агент |
|---|---|---|
| `voice.json` | пользователь или форма «Голос» на доске (`PUT .../post/voices`) | не выдумывает `voice_id` |
| `lines.json` | доска: правка реплики, озвучка, сборка таймлайна | нет |
| `voices/**` | задание озвучки; `current.json` ещё и выбор версии на доске | нет |
| `manifest.json`, `timeline/**` | «Собрать таймлайн» | читать |
| `jobs/**` | доска | нет |

Ничего в `post/` доска не удаляет.

## Реплики

Текст и персонаж — **только из `shots/{shotId}/speech.md`** (одна реплика на строку, `Имя: текст`; строка без имени — реплика единственного персонажа кадра из `shot.md`). Имя приводится к папке библиотеки (`julia` → `Julia`). Порядок — порядок кадров таблицы.

`lines.json` → `{ updatedAt, lines: [{ id, shotId, character, text, order, at, atManual, trimIn, trimOut, speed }] }`:

- `id` — `{shotId}-{номер строки}`: `s05-2`.
- `at` — секунды от начала кадра, где начинается речь. `atManual: false` — доска считает место сама при каждом чтении: если в финале кадра есть свой звук (H3, HeyGen), реплики ставятся на его звучащие отрезки (`silencedetect`, границы между репликами — самые длинные паузы); иначе подряд: первая на 0.3 с, следующие через 0.4 с после конца предыдущей (длительность — по озвучке, без неё ~15 символов в секунду).
- `trimIn`, `trimOut` — сдвиг границ отрезка относительно авто-границ, секунды (минус — раньше).
- Текст реплики в speech.md изменился — `trimIn/trimOut` сбрасываются, `at` остаётся, озвучка реплики считается устаревшей.

Чтение (`GET .../post`) ничего не пишет.

## Голос и озвучка

`voice.json` → `{ "voice_id", "model_id", "text_prefix", "voice_settings": { stability, similarity_boost, style, speed, use_speaker_boost }, "seed" }`. `model_id` по умолчанию `eleven_v3` (модель проекта).

`text_prefix` — аудиотег, который доска дописывает перед **каждой** фразой персонажа при **каждой** отправке: `[strong Russian accent] Who is that guy?`. Поля нет — `[strong Russian accent]`; пустая строка — без тега. В `speech.md`, `lines.json`, манифест и субтитры тег не попадает; реплика в таймстемпах ищется без него, так что начало речи — первое слово. Модели v2 теги не понимают и прочтут вслух.

Озвучка персонажа — одна новая версия `v{N}`:

1. Все реплики персонажа по порядку, каждая с `text_prefix`, через `\n<break time="1.0s" />\n` (для `eleven_v3` — пустая строка: `<break>` он не понимает).
2. Куски не длиннее `POST_TTS_CHUNK_CHARS` (по умолчанию 2500) символов, реплика не режется. Каждый кусок — `POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128`; следующий получает `previous_request_ids` (до 3 последних `request-id`), у `eleven_v3` склейки запросов нет — `previous_text`.
3. Куски → `v{N}.wav` (44.1 кГц, моно), между кусками 1 с тишины.
4. Реплика в ответе ищется по тексту в `alignment.characters`. Край звука уточняется по тишине (`silencedetect`, −35 дБ, 0.2 с): конец — начало тишины после реплики (затухание, выдох), начало — конец тишины перед ней. Отрезок: звук + 0.12 с до и 0.2 с после, но не дальше середины паузы до соседней реплики.
5. `v{N}.json` → `{ version, character, createdAt, file, duration, config, chars, chunks: [{ file, requestId, text, lineIds, offset, duration }], lines: [{ id, text, speechStart, speechEnd, in, out }] }`; `current.json` переключается на новую версию.

Ошибка посреди — оплаченные куски остаются на диске, версия не становится текущей. Номер версии не переиспользуется.

Перегенерация персонажа не теряет правки: `at`, `trimIn`, `trimOut` хранятся в `lines.json` по `id` реплики и применяются к новой версии, пока текст реплики не изменился. Правки, сделанные в Resolve, доска не видит (бесплатная версия без скриптов): договорено, что грубо — на доске, окончательно — в Resolve, после этого таймлайн заново не собирают.

## Платная отправка

Задание озвучки ставит только `POST .../post/voice-job` с `allowPaid: true` — галочка «Разрешить платную отправку в ElevenLabs» на один запуск, рядом оценка стоимости в символах. Без неё — ошибка, в ElevenLabs ничего не уходит. Ключ — `ELEVENLABS_API_KEY` в `.env.local` (вписывает пользователь). `ELEVENLABS_URL` — другой адрес (тесты).

`jobs/voice-*.json` → `{ id, episodeId, characters, status: pending|running|done|error, chars, allowPaid, createdAt, startedAt, finishedAt, pid, progress, results: [{ character, version }], error }`. Выполняется в процессе доски сразу после постановки, одно задание на эпизод за раз. Повторной отправки нет: задание, которое процесс не выполняет (доска перезапускалась), показывается и записывается как `error` «Озвучка прервалась…».

## Речь в кадрах — под губы

У финалов H3/HeyGen есть своя речь с липсинком. «Распознать речь» (`POST .../post/speech`) ставит в очередь доски (`data/comfy_queue`, локальный ComfyUI, бесплатно) граф `playbooks/workflows/comfy/create_subtitles_file_from_video.json` (ComfyUI-Whisper, JSON не правится): видео из `final_render/approve/` подставляется в `VHS_LoadVideo`, задание с `saveText: true`. Слова Whisper (`PreviewAny` от `words_alignment`) — `{ value, start, end }`.

- Распознавание привязано к файлу финала (имя, размер, время): финал заменили — статус `stale`, рамок нет до нового прогона («заново»).
- Слова сопоставляются с репликами кадра по тексту (выравнивание с сохранением порядка, лишние слова Whisper не мешают). Найдено меньше 40 % слов реплики — рамки нет.
- Рамка губ реплики `[start, end]` (секунды от начала кадра): авто-место `at` = `start`; скорость клипа = длина речи озвучки / длина рамки, в пределах 0.8–1.35× (за пределами — предупреждение «нужно N×»).
- Ручная скорость — `lines.json` → `speed` (число; `null` — авто), правится на доске.
- Скорость есть только в проекте Kdenlive: продюсер MLT `timewarp` с `warp_pitch=1` (тон не меняется, как «Изменить скорость» с компенсацией тона). В FCPXML клипы без ускорения (предупреждение в манифесте).

## Проект Kdenlive

«Собрать проект» пишет рядом с FCPXML `timeline/{ep}_v{N}.kdenlive` той же сборки (`src/lib/post/kdenlive.ts`, формат документа 1.1, Kdenlive 23.04+, проверено на 26.08 через `melt`). Kdenlive: File → Open. Профиль — размер кадра сборки, 24 fps. Дорожки:

- «Кадры» (V1) — финалы подряд, без своего звука; кадр без финала — пустота;
- по дорожке на персонажа (A1… в порядке первой реплики) — реплики-отрезки длинного wav, тот же вход/выход и место, что в манифесте;
- «Звук финалов (выкл.)» (нижняя A) — звук H3/HeyGen, дорожка выключена (`hide="both"`).

Реплики одного персонажа не могут наезжать на одной дорожке: конец предыдущей обрезается по началу следующей (в `warnings` есть «наезжает»). Пути к файлам абсолютные: проект открывать из `post/timeline/`, файлы озвучки и кадров не переносить.

## Таймлайн (FCPXML 1.9)

Resolve: File → Import → Timeline. Секвенция 24 fps, размер кадра — выбор на доске (720×1280 по умолчанию).

- Лента: финалы кадров (`final_render/approve/`, первое видео) подряд, только видео (`srcEnable="video"`). Кадр без финала — `<gap>` не короче 3 с.
- Дорожка −1: свой звук финалов H3/HeyGen, клипы `enabled="0"` — для сверки с губами.
- Дальше дорожка на персонажа (−2, −3… в порядке первой реплики). Реплика — отрезок `v{N}.wav` (`start` = вход в источнике), поставленный так, чтобы начало звука пришлось на `начало кадра + at`. Все отрезки персонажа — один ассет.
- Реплики без актуальной озвучки не попадают в таймлайн (`manifest.skipped`).
- Времена округляются до кадра 1/24.

`manifest.json` → `{ episodeId, builtAt, fps, width, height, timeline, duration, characters: [{ name, lane }], shots: [{ shotId, file, start, duration, hasAudio }], lines: [{ id, shotId, character, text, source, sourceIn, sourceOut, at, timelineStart, timelineEnd, lane }], skipped: [{ id, reason }], warnings }`.

## API

| Метод и путь | Что делает |
|---|---|
| `GET /api/episodes/{ep}/post` | `PostState`: реплики с отрезками, голоса, финалы, таймлайны, последнее задание |
| `PATCH .../post/lines` `{ id, at?, trimIn?, trimOut?, speed? }` | правка реплики (`at: null`, `speed: null` — вернуть авто) → `PostState` |
| `PUT .../post/voices` `{ character, voice_id, model_id?, voice_settings?, seed? }` | `voice.json` → `PostState` |
| `POST .../post/voices` `{ character, version }` | сделать версию озвучки текущей → `PostState` |
| `POST .../post/voice-job` `{ characters, allowPaid: true }` | озвучка (платно) → `VoiceJob` |
| `POST .../post/speech` `{ shotIds?, force? }` | распознать речь финалов (Whisper, очередь ComfyUI) → `{ queued, skipped }` |
| `POST .../post/timeline` `{ width?, height? }` | новая версия: `.kdenlive` и `.fcpxml` → `Manifest` (`kdenlive`, `timeline`) |
| `GET .../post/file?path=` | файл папки поста (`.wav .mp3 .json .fcpxml .kdenlive .srt`), Range для звука; таймлайны — на скачивание |
