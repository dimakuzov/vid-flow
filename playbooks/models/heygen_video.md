# Model: HeyGen Video 1.0 (Comfy Cloud)

Оригинал на русском. Для модели: `playbooks/models/heygen_video.en.md`.

Финал для диалога: двое (или больше) говорят друг с другом, и губы у каждого двигаются на своих репликах. Граф `playbooks/workflows/comfy/heygen_video_i2v_api.json`, нода `HeyGenImageToVideoNode`, Image to Video от утверждённого первого кадра. Работает только в Comfy Cloud и тратит кредиты (около 45.3 за 10 с, 5–15 с); доска отправляет его только после галочки разрешения на странице этапа.

`prompt.md` — весь `model.prompt`: один абзац на английском, без заголовков и разделов. Доска ничего не дописывает.

## Как писать

1. **Сценарий по порядку.** Модель читает буквально, поэтому действия идут в той последовательности, в которой происходят: держит руку, отпускает, говорит, берёт снова, поворачивается. Не пересказывать и не возвращаться назад во времени.
2. **Каждый человек — по внешности и месту в кадре.** `On the left is Julia, with long dark hair and round glasses, in a green tweed coat; on the right is Lena, with a long brown braid, in a black leather jacket.` Дальше — по имени. Так модель не путает, кто говорит. Внешность — по промпту первого кадра из задачи, одежду не выдумывать.
3. **Реплики в кавычках, привязанные к человеку.** `Julia talks animatedly and says in a lively, dreamy voice: "...like to imagine things."` Модель произносит ровно то, что в кавычках. Каждая реплика из `speech.md` — дословно и по порядку; без какой-то реплики доска запуск не делает.
4. **Фраза про губы.** `Each girl's lips move only on her own line, in sync with every word; while one speaks, the other keeps her mouth closed.` (двое мужчин — `Each man's lips…`, смешанная пара — `Each person's lips…`). Это прямая рекомендация гайда для сцен с двумя говорящими.
5. **Блок Audio в конце.** Без него звук выбирает модель, включая музыку. Назвать нужные звуки и закончить `No music.` Пример: `Audio: their footsteps on dry fallen leaves, the rustle of the bag, a quiet night park room tone with a faint wind in the bare branches. No music.`
6. **Необязательное начало:** `Start exactly from the first frame and keep both girls, their outfits and the lighting as shown.` Нода и так берёт картинку первым кадром; фраза только напоминает модели не менять людей и одежду.

Камера — один раз и просто (`Medium long tracking shot: the camera moves backward smoothly at walking pace…` или `Static shot, fixed camera.`). Перед блоком Audio — `Realistic, natural movement, real skin texture.`

Длительность в промпт не пишется: доска берёт длину утверждённого превью (с округлением, в пределах 5–15 с).

## Пример, который сработал

```text
Start exactly from the first frame and keep both girls, their outfits and the lighting as shown. Medium long tracking shot: the camera moves backward smoothly at walking pace, keeping both girls in front of it, in a moonlit autumn park at night, bare black trees, fallen leaves on the path, cold blue moonlight with warm orange glow of leaves in the background. On the left is Julia, with long dark hair and round glasses, in a green tweed coat with a dark fur collar and cream trousers; on the right is Lena, with a long brown braid, in a black leather jacket and a dark brown skirt, a black canvas bag on her shoulder. They walk side by side toward the camera. Julia talks animatedly, gesturing with one hand, and says in a lively, dreamy voice: "...like to imagine things. I like fantasy fiction..." Lena walks beside her, not listening; in the first second her hand slides into the open bag and starts rummaging through it. Then Lena stops dead, her hand frozen inside the bag, her eyes wide, her lips parted, her expression one of stunned shock and disbelief, her natural skin tone unchanged, and she says in a shaky, panicked whisper: "Oh my God... I've lost my diary!" Julia takes one more step, then slows and turns toward Lena, her mouth closed. The shot ends on Lena standing completely still. Each girl's lips move only on her own line, in sync with every word; while one speaks, the other keeps her mouth closed. Realistic, natural movement, real skin texture. Audio: their footsteps on dry fallen leaves, the rustle of the bag, a quiet night park room tone with a faint wind in the bare branches. No music.
```

## Перед отправкой

1. Один абзац, английский, по порядку событий.
2. Каждый человек: внешность + место (слева / справа), дальше имя.
3. Каждая реплика из `speech.md` — в кавычках, дословно, у своего говорящего, по порядку.
4. Фраза про губы.
5. Блок Audio с `No music.` в конце.
6. Никаких имён файлов, меток `@img` и заголовков разделов.
