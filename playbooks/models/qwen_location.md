# Model: Qwen location

Оригинал на русском. Для модели: `playbooks/models/qwen_location.en.md`.

Промпты локации под конкретный кадр. Куда класть файлы: `playbooks/stages/location.md`. Граф простых ракурсов: `playbooks/workflows/location_comfy.md`.

Писать только о том, что есть на `view.png` и в `description.txt`. Детали из текста шота, которых нет на референсе, не добавлять. Референс локации важнее текста.

## Какой промпт

| Задача | Промпт |
| --- | --- |
| A. Новый простой ракурс | Четыре ветки ниже. Свет не описывать |
| Сложный ракурс | Два референса: локация и чужая камера |
| B. Правка готовой картинки | `Edit image 1`, нумерованные шаги, в конце абзац Keep the composition |

Людей в кадре нет.

## A. Четыре ветки

Порядок: сначала команда камере, потом что должно быть в кадре. В конце короткая фраза, что это та же локация и без людей.

Словарь, на который LoRA Multiple-angles реагирует лучше всего. За раз одна-две команды, не каскад:

- `Rotate the camera 45 / 90 / 180 degrees to the left / right.`
- `Move the camera forward / back / down / up.`
- `Turn the camera to a close-up / wide-angle lens / top-down view / low-angle view / aerial view.`

Ветки:

1. **simple** — одна фраза: крупность и куда смотрим. Только для близкого ракурса.
2. **objects** — только предметы с референса, их реальные цвета и материалы из `description.txt`. Чаще всего идёт в работу.
3. **camera** — одна-две команды из словаря и `Keep the same room, no people.` Для простого поворота.
4. **camera + objects** — ветка 3, затем `In frame:` и ветка 2.

Пример objects, который взяли без правок:

```text
The narrow bed along the wall seen from the front and slightly above: white sheet,
flat white pillow, the small oriental rug-napkin and a crumpled blanket, folded dark
trousers lying on the bed, the blue-beige patchwork wallpaper behind, the parquet
floor and the edge of the green-blue rug at the bottom. No people.
```

Если референс снят сверху, камера за один шаг часто остаётся под потолком. Сначала сделать промежуточный вид на уровне глаз и крутить уже от него. Разворот на 180° вместе со сменой высоты — не задача для A.

Пустой латент 768×1344, выход 9:16. Четыре варианта за запуск. Лишние пустые ветки не запускать.

### В `prompt.md` на доске

Каждая ветка — свой раздел, заголовок `## <ветка>`. Доска отдаёт раздел в свою ветку графа. Ветку без раздела не запускает.

```md
## simple
Medium shot of the bed from the front, eye level. Same bedroom, no people.

## objects
The narrow bed along the wall seen from the front: white sheet, flat white pillow, the blue-beige patchwork wallpaper behind. No people.

## camera
Rotate the camera 45 degrees to the right. Keep the same room, no people.

## camera_objects
Rotate the camera 45 degrees to the right. In frame: the narrow bed, white sheet, the patchwork wallpaper. Keep the same room, no people.
```

Разделы: `simple`, `objects`, `camera`, `camera_objects`. Без заголовков весь текст уходит во все четыре ветки (старое поведение: четыре варианта отличаются только seed). Текст до первого заголовка и другие имена разделов — ошибка.

## Сложный ракурс

image 1 — наша локация. image 2 — любое фото с нужной камерой. Локация переносится в чужую композицию. Содержимое image 2 запрещается.

1. `Recreate the <location> from image 1 from the camera angle and composition of image 2.`
2. **Camera position:** где стоит камера и куда смотрит, через объекты: что у нижнего края, что уходит вправо, что вверху. Одних слов `low angle` мало.
3. **Keep everything from image 1 exactly:** материалы, цвета и объекты из `description.txt`, свет и гамма.
4. Роль image 2: `Use image 2 only for the camera angle and framing, do not copy its …` и список лишнего на чужом фото.

```text
Recreate the lecture hall from image 1 from the camera angle and composition of image 2.

Camera position: low, at floor level at the front end of the seating, right next to the
first row of desks, looking diagonally up and across the tiered rows. The curved backs of
the front benches are very close to the camera in the lower left foreground and sweep away
to the right, each following row stepping higher behind the previous one, forming the arc
of the amphitheater. The upper rows and the tall windows are at the top of the frame, the
floor of the front aisle is visible in the lower right corner.

Keep everything from image 1 exactly: the dark aged wooden benches and desks, the
wood-paneled wainscoting, the pale grey-blue upper walls, the tall white-framed windows,
the spherical milk-glass pendant lamps, the grey stone floor, the dim overcast lighting
and the muted desaturated colors. Use image 2 only for the camera angle and framing, do
not copy its projector, parquet floor, clock, radiators or bright lighting.
```

После этого прохода обычно нужна чистка из раздела B.

## B. Правка

Qwen Image 2.1 edit. Свет, сезон, объект и чистка — отдельные проходы, не вместе с поворотом камеры.

1. `Edit image 1.`
2. Что сохранить — списком реальных объектов кадра.
3. Что сделать — пронумерованными шагами, одно действие на шаг. Новый объект: `add`, не `replace`.
4. Роль каждого референса: `Put exactly the same bus stop as in image 4 — same shape, structure, roof. Do not redesign it.`
5. Стык: `Relight the new elements to match image 1. Match the perspective and scale of image 1. Natural photographic look, no collage effect.`
6. `The scene is completely empty: no people. If images 2, 3 or 4 contain people, remove them.`
7. Финальный абзац чистки, дословно:

```text
Keep the composition, camera angle, framing and all objects from image1. Every object
must stay the same object, with the same type, shape, size, design and position.
Do not replace, reinterpret or redesign any other object. Only improve how each object
is rendered: remove noise, blur and compositing artifacts, and render crisp surfaces,
fine textures, clean reflections and highlights that closely match the original
materials and colors. Keep the original lighting from image1, clean shadows without noise.
```

Короткая фраза вроде `This is a dark wooden door.` фиксирует объект, который модель норовит перерисовать.

Короткие правки, которые уже срабатывали:

- Свет: `Make the image darker, as on a heavy overcast day just before dusk.`
- Сезон: `Remove all leaves: the tree branches stay in place but are bare. The grass is dull and faded.`
- Лишний объект: `Remove the white pedestrian crossing markings completely. In their place, continue the same dark wet asphalt.`
- Геометрия: `Correct the building geometry: straight vertical walls, straight horizontal lines, evenly aligned windows and balconies.`

Длинное описание комнаты, которая уже есть на image 1, модель читает как задание и перерисовывает локацию. Описывать только изменение. Остальное — «сохрани».

## Не писать

- Не описывать локацию, которая уже есть на image 1.
- Не описывать свет на проходе A.
- Не брать детали из текста шота, если их нет на референсе.
- Не соединять большой поворот, смену высоты и смену крупности одной командой в A.
- Не просить малую глубину резкости. Фон оставлять резким.
- Не подавать image 2 без роли: модель заберёт оттуда предметы и свет.
- Не писать все правки одним абзацем. Нужны нумерованные шаги.

## Перед запуском

1. Простой ракурс → A. Сложный → два референса. Правка → B.
2. В промпте только то, что есть на `view.png` и в `description.txt`.
3. В A одна-две команды камеры, без света.
4. В B роли картинок названы, шаги пронумерованы, абзац Keep the composition стоит в конце.
5. В кадре нет людей.
6. Выход 9:16. В A четыре варианта, в B два-пять сидов. Дальше правится лучший, а не переписывается всё.
