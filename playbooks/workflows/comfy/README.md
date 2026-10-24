# Comfy graphs

Графы в формате API. Доска запускает их через манифесты `*.bind.json` (`docs/contracts/graph-binding.md`): манифест говорит, какие файлы и какой текст идут в какие ноды. Новый вариант этапа = граф + манифест, без правки кода.

| Манифест | Этап | Граф | Кто запускает |
| --- | --- | --- | --- |
| `location_views` | `location` | `location_views_multiple_angles.json` | доска; разделы `## simple/objects/camera/camera_objects` в `prompt.md` |
| `location_krea2` | `location` | `location_krea2_api.json` (Krea 2 Turbo, локация с нуля; как пересохранить — `drafts/README.md`) | доска; один абзац в `prompt.md`, картинка из `refs/` необязательна |
| `location_firered` | `location` | `location_firered_edit.json` (FireRed-Image-Edit-1.1, Lightning включена) | доска; 1–3 картинки из `refs/`, промпт — `models/firered_location.en.md` |
| `first_frame_compositing` | `first_frame` | `qwen21_character_compositing.json` | доска |
| `video_i2v`, `video_flf` | `video_preview` | `wan22_i2v_sketch_turbo_api.json`, `wan22_flf_sketch_turbo_api.json` | доска |
| `video_ltx` | `video_preview` | `ltx25_i2v_api.json` (LTX 2.5 i2v, 24 к/с, со звуком) | доска; промпт — `models/ltx_video.en.md` |
| `final_wan_720` | `final_render` | `wan22_i2v_sketch_turbo_api.json` (720×1280, 24 к/с) | доска; промпт — из метаданных утверждённого эскиза |
| `final_ltx` | `final_render` | тот же `ltx25_i2v_api.json` (1.2 Мп, 832×1504, 24 к/с) | доска, по умолчанию если эскиз LTX |
| `video_minimax` | `video_preview` | `minimax_h3_preview_api.json` (MiniMax H3 по референсам + ЛоРа Cinema, один проход 0.5 Мп) | доска; «▶ Все кадры» гонит его вторым, после `video_ltx` (`run_chain.json`) |
| `final_h3_cinema` | `final_render` | `minimax_h3_cinema_api.json` (MiniMax H3 по референсам + ЛоРа Cinema) | доска; `prompt.md` — текст модели целиком, с `subject_definitions ASTROCINEMAV01K2T:` первой строкой; первый кадр — `<Picture 1>`, лица персонажей — `<Picture 2…7>` |
| `final_h3_head_swap` | `final_render` | `minimax_h3_head_swap_api.json` (MiniMax H3, замена головы по листу лица, без промпта) | доска; доступен только с одним персонажем, его `face_sheet` и утверждённым превью |
| `final_heygen` | `final_render` | `heygen_video_i2v_api.json` (Comfy Cloud) | доска, только с галочкой на этот запуск |
| `final_i2v` | `final_render` | граф Wan i2v превью | доска, запасной вариант |
| `final_flf` | `final_render` | `wan22_flf_sketch_turbo_api.json`, 720×1280, 24 к/с | доска; по умолчанию после эскиза FLF; промпт и последний кадр эскиза |
| — | `characters` | `character_outfit_qwen21.json` (правка одежды, image 1 — персонаж, image 2 — образец) | агент по `characters_comfy.en.md`; манифест — черновик в `drafts/` |

Черновики, которые ещё не проверены в ComfyUI: `playbooks/workflows/drafts/`.

## После пересохранения графа

1. Экспорт из ComfyUI в формате API под тем же именем.
2. Если поменялись id нод — поправить манифест в том же коммите.
3. `npm test`: проверка манифестов (`src/lib/contracts/graph-binding.test.ts`) падает, если нода, поле или путь внутри JSON пропали из графа.
