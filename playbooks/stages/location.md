# Stage: location

Shot-вариант локации без персонажей. Промпты и Comfy-граф локации ещё не подключены: когда придут документы, они лягут сюда и в `playbooks/workflows/`, по той же схеме, что персонаж.

## Зависимость от базы

Общий вид локации лежит вне шота:

```text
data/series/locations/{locationId}/
```

`{locationId}` — то же имя, что в `scenario.md` и `shot.md` (`night_cafe`, `street_rain`). Точный набор файлов внутри папки зафиксируем вместе с документами локации. Пока это общий вид, от которого собирается кадр.

Shot-вариант живёт в обычном этапе:

```text
shots/{shotId}/location/
  refs/  output/  approve/
  prompt.md  llm_notes.md  refs.md  workflow.md  status.json
```

В `approve/` — один выбранный файл. Он идёт в `first_frame`. Базовую папку локации этап не заменяет.

В `refs/` кладётся общий вид из `data/series/locations/{locationId}/` и пометки в `refs.md`, что это база, а не результат кадра.
