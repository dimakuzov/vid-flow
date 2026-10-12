# LTX 2.5 — как писать промпт эскиза видео

Оригинал на русском. Для модели: `playbooks/models/ltx_video.en.md`.

Манифест доски: `video_ltx` (этап `video_preview`), граф `playbooks/workflows/comfy/ltx25_i2v_api.json`: LTX 2.5 distilled, картинка в видео, 24 к/с, два прохода с апскейлом латента, со звуком. Первый кадр — самый новый файл в `first_frame/approve/`.

Истории прогонов LTX на проекте пока нет. Ниже — правила Wan, которые переносятся (`playbooks/models/wan_video.md`), и форма первого промпта LTX, который написал пользователь. Дописывать по итогам прогонов.

## Шаблон

```text
use image as the first frame. <кто, по одной видимой примете> <исходное состояние, ровно как на первом кадре>. <действие 1>. Then <действие 2>. Static camera. <конечное состояние кадра>. Realistic, natural movement.
```

1. **Первые слова всегда `use image as the first frame.`** Так начинается рабочий промпт пользователя.
2. **Камера одной короткой фразой:** `Static camera.` Если кадру нужно движение камеры — ровно одно движение и его скорость.
3. **Начало = первый кадр.** Действие начинается с того, что уже на картинке: те же места, позы и направление, куда смотрят люди. В задаче есть описание утверждённого первого кадра; следовать ему, а не формулировкам сценария.
4. **Люди по одной видимой примете, не по имени:** `the young woman with a long braid`, `the man in the white jacket`. Примету брать из описания первого кадра.
5. **Одно-два действия по порядку, со связками:** `First… Then…`. Без связок модель делает всё сразу.
6. **Сказать, докуда идёт движение:** `runs past the left side of the camera and leaves the frame`, `takes two steps towards the window`. LTX доигрывает клип движением; открытое действие продолжается.
7. **Ничего не появляется, чего нет на первом кадре,** если кадру это не нужно; если нужно — сказать, откуда (`a man enters from the dark archway in the background`).
8. **Речь.** LTX сам делает звук и может заставить человека говорить. Если в задаче есть реплики (раздел «Lines», из `speech.md`), каждая реплика идёт в промпт: кто говорит и что, в том порядке, в каком говорят. Больше ничего: ни голоса, ни интонации, ни акцента.
   - Кто: та же видимая примета, что и в действии (`the young woman with the braid`), не имя.
   - Слова — дословно как в `speech.md`, на их языке, в двойных кавычках.
   - Порядок — связками: `says: "…"`, `Then the man in the white jacket answers: "…"`.
   - Реплика стоит там, где она звучит по ходу действия. Реплик в задаче нет — никто не говорит, речь не выдумывать.
9. **Другой звук (по желанию).** Одна короткая фраза, если он важен: `Heavy rain, footsteps on wet stone.` Музыку — только по просьбе.
10. **Длина:** 50–90 слов, не считая реплик. В длинном промпте модель отыгрывает каждое слово.
11. **Длительность** ставит доска (меню этапа, иначе `N sec` в prompt.md). Если в задаче сказано, что длительность выбрана в меню, `N sec` не писать. Действие и реплики должны в неё уложиться.
12. **Ни имён файлов, ни путей, ни номеров картинок, кроме `image`.**

## Пример (первый промпт LTX пользователя, сокращён)

```text
use image as the first frame. The frightened young woman in the foreground bursts into action and runs fast, straight forward, past the left side of the camera, and leaves the frame. At the same moment the dark silhouette in the coat and hat in the distant background breaks into a sprint after her. Static camera. The backlight and the rim light on the pursuer stay as they are. Realistic, natural movement.
```

## Пример с речью

```text
use image as the first frame. The young woman with the braid stands by the window, her back to the wall, and looks at the man in the white jacket. She says: "Кто вы такой?" Then the man in the white jacket takes one slow step towards her and answers: "Ты меня не помнишь?" Static camera. They keep looking at each other. Realistic, natural movement.
```

## Перед запуском

1. Начинается с `use image as the first frame.`
2. Начало совпадает с утверждённым первым кадром: места, направление, позы.
3. Люди по одной видимой примете.
4. Одно-два действия со связками, у каждого есть конец.
5. `Static camera.` или ровно одно движение камеры.
6. Каждая реплика из задачи — дословно, в кавычках, с тем, кто говорит, и по порядку; лишних реплик нет.
7. 50–90 слов кроме реплик; без `N sec`, если длительность выбрана в меню.
8. Сразу 2–3 seed.
