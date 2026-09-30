# Global playbooks

Эти документы глобальны для всех серий. В папку серии их не копировать.

Структура:

- `models/` — как писать промпты под конкретную модель
- `stages/` — что делает каждый этап кадра и от какой базы он зависит
- `workflows/` — как гонять Comfy вручную
- `workflows/comfy/` — сами JSON-графы

Базы identity серии (не playbooks):

- `data/series/characters/{name}/` — portrait, side, full body
- `data/series/locations/{locationId}/` — общий вид локации

Shot-этапы `characters` и `location` собирают вариант кадра из этих баз. Контракт этапа тот же: `refs/`, `output/`, `approve/` и пять документов.

Сейчас заполнены правила shot-персонажа (Qwen Image Edit, гипотеза «образ + скелет + лицо»):

- `stages/characters.md` — оригинал на русском, для модели `stages/characters.en.md`
- `models/qwen_image.md` — оригинал на русском, для модели `models/qwen_image.en.md`
- `workflows/characters_comfy.md` — оригинал на русском, для модели `workflows/characters_comfy.en.md`
- `workflows/comfy/character_pose_outfit_qwen.json`

Ракурсы локации (проверено на прошлом проекте: ветка objects чаще всего идёт в работу):

- `stages/location.md` — оригинал на русском, для модели `stages/location.en.md`
- `models/qwen_location.md` — оригинал на русском, для модели `models/qwen_location.en.md`
- `workflows/location_comfy.md` — оригинал на русском, для модели `workflows/location_comfy.en.md`
- `workflows/comfy/location_views_multiple_angles.json`

Первый кадр (вписать утверждённых персонажей в утверждённую локацию):

- `stages/first_frame.md` — оригинал на русском, для модели `stages/first_frame.en.md`
- `models/qwen_first_frame.md` — оригинал на русском, для модели `models/qwen_first_frame.en.md`
- `workflows/first_frame_comfy.md` — оригинал на русском, для модели `workflows/first_frame_comfy.en.md`
- `workflows/comfy/qwen21_character_compositing.json`

Страница этапа показывает путь к `stages/{stage}.md`, `workflows/{stage}_comfy.md`, английскую пару `.en.md` и model playbook. Граф персонажа виден на этапе `characters`, граф ракурсов — на `location`, граф сборки кадра — на `first_frame`.
