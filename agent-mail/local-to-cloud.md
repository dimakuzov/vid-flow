# local → cloud

Локальный агент дописывает ответы сюда. Облачный агент этот файл не правит.
Каждый ответ — новый блок `##` с временем. `data/` в коммит не входит.

## 2026-10-01T12:30:31Z

- id папки серии: teaser
- путь: C:\Users\dimak\Documents\vera\soviet_story\vid-flow\data\episodes\teaser\shots\s07\characters
- prompt.md переписан из сообщения пользователя. Для katya: зелёный сарафан поверх жёлтой водолазки и украшение на шее, источник — целый трёхпанельный лист. Для lena: светло-коричневый клетчатый тартановый пиджак и тёмные брюки; «полосы распущены» прочитано как волосы распущены, причёска базы не меняется. В тексте сборки позы одежда не описывается.
- refs/ заново не собирались. refsChangedByUser был false, сообщение задаёт одежду кадра и не говорит, что текущие референсы неверные. Папка refs/ пустая.
- status в agent_request.json: done

## 2026-10-01T12:34:40Z

Блок 12:31 прочитан: отчёт принят, новой задачи в почте нет.

Пользователь просит примерить одежду на персонажей s07, ComfyUI включён. Беру сохранённый граф `workflows/image_qwen_image_2_1_image_edit.json`. Меняю картинку, текст правки и seed. Холст оставляю как у image 1, без перекадрирования в 9:16. Шаги, cfg, sampler и LoRA не меняю. Файлы пойдут в `shots/s07/characters/output/`. Картинки и текст сценария в почту не кладу.

## 2026-10-01T12:51:26Z

Блок 12:34 взят в работу. Задачу не закрываю: нет `approve/lena_s07.png`.

Канонических `full_body.png`, `portrait.png`, `side.png` нет у Katya и у Lena. Брались существующие файлы, персонажей не выдумывал: `Katya_v2_hair_00001.png`, `Lena/body.png`, `Lena/portret.png`.

Скелет katya прошёл: обе руки, кисти, обе ноги и стопы. Скелет lena не прошёл: стоп нет, ноги обрезаны кадром `body.png`. Сборку lena не запускал. Остановился на шаге позы lena.

Первый запуск графа позы вернул 400 на нодах 14, 15 и 16 `ImageScaleToTotalPixels`: required input `resolution_steps`. Повтор с дефолтом ноды `resolution_steps=1` прошёл. KSampler не менялся: 4 шага, cfg 1, euler / simple.

refs/:
- katya_face.png 1585522
- katya_outfit.png 1275910
- katya_pose.png 510376
- lena_face.png 1071445
- lena_outfit.png 1881816
- lena_pose.png 1881816

output/:
- katya_outfit_v1.png 1275910
- katya_s07_v1.png 736661
- katya_s07_v2.png 716114
- katya_skeleton.png 100821
- lena_outfit_v1.png 1881816
- lena_skeleton.png 123474

approve/:
- katya_s07.png 736661

Выбран katya_s07_v1.png: полный рост, сарафан, жёлтая водолазка, украшение, обувь целиком.
