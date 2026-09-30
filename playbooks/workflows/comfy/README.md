# Comfy graphs

JSON открывается в ComfyUI вручную. Frameboard граф не запускает.

| Файл | Этап | Статус |
| --- | --- | --- |
| `character_pose_outfit_qwen.json` | `characters` | Гипотеза: образ + скелет позы + лицо |
| `location_views_multiple_angles.json` | `location` | Простой ракурс, четыре ветки, 9:16. Формат API |
| `qwen21_character_compositing.json` | `first_frame` | Вписать персонажей в локацию. Формат API |

Персонаж: `playbooks/workflows/characters_comfy.md`. Локация: `playbooks/workflows/location_comfy.md`. Первый кадр: `playbooks/workflows/first_frame_comfy.md`.
