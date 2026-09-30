# База локаций

Общий вид локации, общий для серии. Shot-вариант собирается в `shots/sXX/location/` и утверждается одним файлом в `approve/`.

Папка называется как локация в `scenario.md` (`night_cafe`, `street_rain`):

- `view.png` — один общий вид
- `description.txt` — предметы, цвета и материалы, которые реально есть на `view.png`

В один проход берётся один `view.png`.

Правила кадра: `playbooks/stages/location.md`. Для модели: `playbooks/stages/location.en.md`.
