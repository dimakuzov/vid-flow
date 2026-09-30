# Stage: first_frame

Собрать стартовый кадр из утверждённых shot-вариантов локации и персонажей.

## Dependencies

Нужны:

- `shots/{shotId}/characters/approve/{name}_{shotId}.png` — вариант, собранный из `data/series/characters/{name}/`
- `shots/{shotId}/location/approve/` — вариант, собранный из `data/series/locations/{locationId}/`

Ручной approve может обойти проверку upstream. В промпт и refs всё равно идут эти утверждённые файлы, не сырые базы: у баз другой кадр, одежда и ракурс.

Промпты и Comfy-граф первого кадра ещё не подключены. Заготовка: `playbooks/workflows/first_frame_comfy.md`.
