# Model: Qwen outfit

Оригинал на русском. Для модели: `playbooks/models/qwen_outfit.en.md`.

Правка одежды персонажа кадра. Граф `character_outfit_qwen21.json`, манифест `character_outfit`. Каждому персонажу — свой раздел `prompt.md`.

## Промпт

Раздел `## имя` строчными латинскими буквами, как имя в shot.md. Пустой раздел — этого персонажа доска не перегенерирует. Текст до первого заголовка и чужое имя раздела — ошибка. Имена персонажей в текст не писать.

Менять только одежду из просьбы пользователя. Лицо, волосы, фигура, поза, фон и остальная одежда — как на image 1. Внешность по памяти не описывать. Имена файлов не писать.

Image 2 — образец одежды, если пользователь положил `refs/{имя}_clothes.*`. Нет файла — нода «image 2: образец одежды» в bypass, и image 2 в тексте не упоминать: одежду описать словами.

```md
## lena
Change the coat in image 1 to a dark wool coat, knee length. The shoes, face, hair, figure, standing pose and plain background stay exactly as in image 1.

## mom
```
