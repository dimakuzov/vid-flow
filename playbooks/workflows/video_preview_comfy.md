# Workflow: video_preview (Comfy)

Эскиз видео, Wan 2.2 turbo. Графы лежат как есть, узлы не переписываются.

- Первый кадр: `playbooks/workflows/comfy/wan22_i2v_sketch_turbo_api.json`
- Первый и последний кадр: `playbooks/workflows/comfy/wan22_flf_sketch_turbo_api.json`

Перед отправкой в очередь меняются только:

| Узел | Поле | Что ставится |
| --- | --- | --- |
| LoadImage 97 | `image` | Файл из `first_frame/approve/` |
| LoadImage 98 | `image` | Только FLF: картинка из `refs/` этого этапа |
| CLIPTextEncode 129:93 | `text` | Промпт кадра |
| KSamplerAdvanced 129:86 | `noise_seed` | Новый seed |
| PrimitiveFloat 129:161 | `value` | Секунды, если они написаны в тексте. Иначе значение из графа |
| SaveVideo 108 | `filename_prefix` | `frameboard/video/{shotId}_i2v` или `_flf` |

Негатив 129:89, шаги, CFG, LoRA, 384×672 и переключатели turbo не трогать. Промпт: `playbooks/models/wan_video.md`.
