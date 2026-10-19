# Model: FireRed location

Оригинал на русском. Для модели: `playbooks/models/firered_location.en.md`.

Новая локация по 1–3 референсам из `refs/`. Граф `playbooks/workflows/comfy/location_firered_edit.json`, манифест `location_firered` (этап `location`, пункт меню «Локация из референсов: FireRed»). Когда выбирать его, а не `location_views` или `location_krea2`: `playbooks/stages/location.md`, раздел «Какой граф».

## Что за модель

FireRed-Image-Edit-1.1. В графе пользователя: `FireRed-Image-Edit-1.1-transformer.safetensors`, текстовый энкодер Qwen2.5-VL 7B (`qwen_2.5_vl_7b_fp8_scaled.safetensors`), VAE `qwen_image_vae.safetensors`. Lightning LoRA включена (`FireRed-Image-Edit-1.0-Lightning-8steps-v1.0.safetensors`): 8 шагов, cfg 1. Холст пустой, 9:16. Картинки модель видит через энкодер, а не как латент правки.

Модель сама умеет 1–3 картинки. Четвёртую доска не отправляет: запуск падает, лишний файл убирают кнопкой «Убрать».

В графе:

| Нода | Что | Кто меняет |
| --- | --- | --- |
| `192:187` | текст промпта | доска: весь `prompt.md` |
| `143`, `144`, `145` | image 1, 2, 3 | доска: файлы `refs/` по имени, не больше трёх. Нет второго или третьего — эта нода в bypass |
| `192:195` | 9:16 | доска |
| `192:189` | seed | доска, случайный. Шаги, cfg, Lightning не трогать |
| `9` | сохранение | префикс `frameboard/location/{shotId}_firered` |

Негатив пустой. Всё нужное — в позитивном промпте.

## Промпт

Короткая команда на английском, один абзац, без заголовков `##`. Не пересказ всей комнаты: Lightning на 8 шагах лучше держит инструкцию, чем длинное описание.

Порядок картинок — порядок имён файлов в `refs/`. Первая по имени — image 1, вторая — image 2, третья — image 3.

1. Что остаётся: материалы, предметы и свет, которые есть на референсах.
2. Что собрать: новая локация под план кадра. Сообщение пользователя о крупности важнее текста шота. Человека из текста шота (вид из-за её плеча) не писать: пустое место с той же дистанцией камеры.
3. Роль каждой картинки одним куском фразы. Нет image 2 или image 3 — эти номера не писать.
4. В конце: `Empty room, no people.`

Людей, домов, машин, вывесок и мебели, которых нет на референсах, не добавлять. Имена файлов не писать.

```text
Build a new 9:16 view of the same room as image 1, eye level, medium shot. Keep the herringbone parquet and the faceted glass from image 1. Take the yellow lamp from image 2 and leave it out of frame, only its light on the wall. Empty room, no people.
```

Один референс — та же форма, без image 2 и image 3.
