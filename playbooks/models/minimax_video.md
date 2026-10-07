# Model: MiniMax Video

Оригинал на русском. Для модели: `playbooks/models/minimax_video.en.md`.

Статус: финальный рендер MiniMax H3 подключён к доске — плейбук `playbooks/models/minimax_h3.md`, варианты `final_h3` и `final_h3_768`. Ниже — заметки до подключения: где MiniMax нужен вместо Wan и какие файлы установлены.

## Где используется

Только для кадров, где Wan 2.2 не справился после двух-трёх раундов (`playbooks/models/wan_video.md`, раздел 5): EP.1 S4, S5, S16, S19 уходили на MiniMax или Seedance. Для эскиза MiniMax не используется.

## Что установлено в ComfyUI

Сверено по папкам `models/` (не запускалось):

| Тип | Файлы |
| --- | --- |
| Диффузия | `minimax_h3_fl2va_pruned_bf16`, `minimax_h3_fl2va_pruned_int8_convrot` (первый + последний кадр), `minimax_h3_ref2va_*` (по референсам) |
| Текст-энкодер | `qwen3vl_32b_minimax_h3_int8_convrot`, `qwen3vl_32b_minimax_h3_nvfp4_awq` |
| VAE | `minimax_h3_video_vae_fp16`, `minimax_h3_video_vae_int8_convrot`, `minimax_h3_audio_vae_fp32` |
| LoRA | `minimax_h3_fl2va_4step_lora`, `minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16`, `minimax/minimax_h3_turbo_4step_pruned_comfyui` |

## Чтобы подключить

1. Собрать в ComfyUI граф first-last (fl2va) с turbo-LoRA 4 шага, проверить на одном кадре из списка выше.
2. Сохранить в формате API в `playbooks/workflows/comfy/minimax_h3_flf_api.json`, написать манифест (`final_minimax_flf`, этап `final_render`, order 40; входы как у `final_flf`).
3. Проверить, что нода сохранения пишет метаданные (`prompt` в контейнере).
4. Дописать сюда: что сработало в промпте, длительность, разрешение, шаблон `prompt.md` по образцу `wan_video.md`, раздел 8. Обновить `.en.md` в том же коммите.
