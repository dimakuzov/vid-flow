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

- `stages/characters.md`
- `models/qwen_image.md`
- `workflows/characters_comfy.md`
- `workflows/comfy/character_pose_outfit_qwen.json`

Страница этапа показывает путь к `stages/{stage}.md`, `workflows/{stage}_comfy.md` и model playbook. Граф персонажа дополнительно указан в списке этапа `characters`.
