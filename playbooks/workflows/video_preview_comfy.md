# Workflow: video_preview (Comfy)

Оригинал на русском. Для модели: `playbooks/workflows/video_preview_comfy.en.md`.

Эскиз видео, Wan 2.2 turbo. Граф запускает доска по манифестам `video_i2v` и `video_flf` (финал — `final_i2v`, `final_flf`, те же графы). Графы лежат как есть, узлы не переписываются.

- Первый кадр: `playbooks/workflows/comfy/wan22_i2v_sketch_turbo_api.json`
- Первый и последний кадр: `playbooks/workflows/comfy/wan22_flf_sketch_turbo_api.json`

Перед отправкой в очередь меняются только:

| Узел | Поле | Что ставится |
| --- | --- | --- |
| LoadImage 97 | `image` | Файл из `first_frame/approve/`, загружается как `{shotId}_start.png` |
| LoadImage 98 | `image` | Только FLF: самая новая картинка в `refs/` этого этапа, как `{shotId}_end.png` |
| CLIPTextEncode 129:93 | `text` | `prompt.md` как есть, без добавок |
| KSamplerAdvanced 129:86 | `noise_seed` | Новый seed |
| PrimitiveFloat 129:161 | `value` | Секунды, если в `prompt.md` есть `N sec` (2–8). Иначе 5 из графа |
| SaveVideo 108 | `filename_prefix` | `frameboard/video/{shotId}_i2v` или `_flf`; финал — `frameboard/final/...` |

Негатив 129:89, шаги, CFG, LoRA, 384×672 и переключатели turbo не трогать. Промпт: `playbooks/models/wan_video.md`.

## Модели

| Нода | Файл |
| --- | --- |
| UNETLoader 129:95 / 129:96 | `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` / `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors` |
| CLIPLoader 129:84 | `umt5_xxl_fp8_e4m3fn_scaled.safetensors`, type `wan` |
| VAELoader 129:90 | `wan_2.1_vae.safetensors` |
| LoRA 129:101 / 129:102 | `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors` / `..._low_noise.safetensors`, сила 1.0 |

Все файлы на диске ComfyUI есть (сверено по папке `models/`).

## Метаданные

`SaveVideo` (108) пишет в контейнер mp4 ключ `prompt`: граф в формате API со всеми значениями, включая текст и seed. Ключ `workflow` (граф интерфейса) появляется, только если клиент присылает `extra_data.extra_pnginfo`; доска шлёт только `prompt`, поэтому его нет. Для повтора прогона хватает `prompt`. Метаданные не пишутся, если ComfyUI запущен с `--disable-metadata`.
