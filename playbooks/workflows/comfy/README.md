# Comfy graphs

Графы в формате API. Доска запускает их через манифесты `*.bind.json` (`docs/contracts/graph-binding.md`): манифест говорит, какие файлы и какой текст идут в какие ноды. Новый вариант этапа = граф + манифест, без правки кода.

| Манифест | Этап | Граф | Кто запускает |
| --- | --- | --- | --- |
| `location_views` | `location` | `location_views_multiple_angles.json` | доска; разделы `## simple/objects/camera/camera_objects` в `prompt.md` |
| `location_krea2` | `location` | `location_krea2_api.json` (Krea 2 Turbo, локация с нуля; как пересохранить — `drafts/README.md`) | доска; один абзац в `prompt.md`, картинка из `refs/` необязательна |
| `first_frame_compositing` | `first_frame` | `qwen21_character_compositing.json` | доска |
| `video_i2v`, `video_flf` | `video_preview` | `wan22_i2v_sketch_turbo_api.json`, `wan22_flf_sketch_turbo_api.json` | доска |
| `video_ltx` | `video_preview` | `ltx25_i2v_api.json` (LTX 2.5 i2v, 24 к/с, со звуком) | доска; промпт — `models/ltx_video.md` |
| `final_wan_720` | `final_render` | `wan22_i2v_sketch_turbo_api.json` (720×1280, 24 к/с) | доска; промпт — из метаданных утверждённого эскиза |
| `final_ltx` | `final_render` | тот же `ltx25_i2v_api.json` (768×1344, 24 к/с) | доска, по умолчанию если эскиз LTX |
| `final_h3`, `final_h3_768`, `final_h3_768_face` | `final_render` | `minimax_h3_creator_api.json` (MiniMax H3, ComfyUI-Continuity) | доска; разделы `## body/...` в `prompt.md`; исходный промпт — из метаданных эскиза |
| `final_heygen` | `final_render` | `heygen_video_i2v_api.json` (Comfy Cloud) | доска, только с галочкой на этот запуск |
| `final_i2v`, `final_flf` | `final_render` | графы Wan превью | доска, запасной вариант |
| — | `characters` | `character_outfit_qwen21.json` (правка одежды, image 1 — персонаж, image 2 — образец) | агент по `characters_comfy.md`; манифест — черновик в `drafts/` |

Черновики, которые ещё не проверены в ComfyUI: `playbooks/workflows/drafts/`.

## После пересохранения графа

1. Экспорт из ComfyUI в формате API под тем же именем.
2. Если поменялись id нод — поправить манифест в том же коммите.
3. `npm test`: проверка манифестов (`src/lib/contracts/graph-binding.test.ts`) падает, если нода, поле или путь внутри JSON пропали из графа.
