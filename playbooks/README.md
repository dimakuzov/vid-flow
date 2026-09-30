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

Страница этапа показывает путь к `stages/{stage}.md`, `workflows/{stage}_comfy.md` и model playbook. Граф персонажа дополнительно указан в списке этапа `characters`.
