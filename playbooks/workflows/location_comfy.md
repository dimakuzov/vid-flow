# Workflow: location (Comfy)

Оригинал на русском. Для модели: `playbooks/workflows/location_comfy.en.md`.

Граф: `playbooks/workflows/comfy/location_views_multiple_angles.json`. Это формат API ComfyUI. Файл открывается перетаскиванием в окно ComfyUI.

Задача прохода A: из `data/series/locations/{locationId}/view.png` получить четыре вертикальных вида 9:16 под конкретный кадр. Как писать тексты: `playbooks/models/qwen_location.md`.

Frameboard граф не запускает.

Четыре промпта внутри JSON — пример комнаты. Перед запуском их заменяют текстами этого кадра.

## Модели

Все ноды встроенные.

| Тип | Файл | Папка ComfyUI |
| --- | --- | --- |
| Diffusion | `qwen_image_edit_2509_fp8_e4m3fn.safetensors` | `models/diffusion_models` |
| Text encoder | `qwen_2.5_vl_7b_fp8_scaled.safetensors` | `models/text_encoders` |
| VAE | `qwen_image_vae.safetensors` | `models/vae` |
| LoRA | `Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors` | `models/loras` |
| LoRA | `Qwen-Edit-2509-Multiple-angles.safetensors` | `models/loras` |

Обе LoRA со силой 1.0.

## Как устроен граф

Картинка локации идёт в текстовый энкодер как референс, не как латент. Латент пустой, 768×1344, поэтому выход всегда 9:16. Если подключить VAE Encode от картинки, кадр возьмёт её пропорции.

Четыре независимые ветки. У каждой свой промпт и сид. За один запуск четыре варианта.

Цепочка модели: UNET → Lightning 4 steps → Multiple-angles → ModelSamplingAuraFlow (shift 3) → CFGNorm.

## Что менять

| Нода | Что поставить |
| --- | --- |
| Load Location Image | `view.png` этой локации. Файл должен лежать в `input` ComfyUI или быть выбран в ноде |
| Prompt v1 simple | Крупность и куда смотрим. `Same room, no people.` |
| Prompt v2 objects | Кадр через предметы с картинки и из `description.txt`. `No people.` |
| Prompt v3 camera | Одна-две команды камере. `Keep the same room and lighting, no people.` |
| Prompt v4 camera + objects | Промпт v3, затем `In frame:`, затем промпт v2 |
| Save v1…v4 | Префикс уже `frameboard/location/v1_simple` и дальше по веткам. При желании добавь id кадра |

Словарь камеры для v3 и v4: `Rotate the camera 45/90/180 degrees to the left/right.` `Move the camera forward/back/down/up.` `Turn the camera to a close-up / wide-angle lens / top-down view / low-angle view / aerial view.`

Сиды у веток разные. Новые варианты тех же промптов — другой сид или `randomize`.

## Что не трогать

- Модели и обе LoRA, силы 1.0.
- KSampler: 4 шага, cfg 1, euler / simple, denoise 1.
- ModelSamplingAuraFlow shift 3, CFGNorm 1.
- Scale Image to Total Pixels: 1 MP.
- Пустой негативный промпт.

## После генерации

1. Файлы появляются в `ComfyUI/output/frameboard/location/`.
2. Скопировать четыре варианта в `shots/{shotId}/location/output/` как `{shotId}_v1_simple.png` … `{shotId}_v4_camera_objects.png`.
3. Четыре промпта записать в `prompt.md` этого этапа, чтобы было видно, какая ветка сработала.
4. Лучший файл положить в `approve/{locationId}_{shotId}.png`.
5. Свет, лишний объект и чистку делать отдельным проходом Qwen Image 2.1. Здесь не перегенерировать.

## Если что-то не так

| Симптом | Что делать |
| --- | --- |
| Кадр не 9:16 | `latent_image` в KSampler идёт от Empty Latent 768×1344, не от VAE Encode |
| Камера почти не сдвинулась | Одна команда вместо трёх. Большой разворот — сначала промежуточный вид, либо два референса из model playbook |
| Появились люди | `no people` во все четыре промпта. Если люди на исходнике, сначала убрать их отдельной правкой |
| Нет размытия фона | Модель его почти не делает. Фон оставлять резким |
| Изменился свет | Свет правится позже отдельным проходом, не в этом графе |
