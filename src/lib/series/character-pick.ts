/**
 * Кнопки «Из output», «Из референса», «Из прошлого кадра» ставят картинку персонажем сразу, без списка.
 * Каждое следующее нажатие берёт следующую картинку из этого источника, после последней — первую.
 * `current` — путь картинки, которая сейчас стоит персонажем; если её нет в списке, начинается с первой.
 * Пустой список — -1: нажимать нечего.
 */
export function nextPickIndex(paths: string[], current: string | null): number {
  if (!paths.length) return -1;
  const at = current ? paths.indexOf(current) : -1;
  return (at + 1) % paths.length;
}

/** Номер текущей картинки в списке (с единицы) или 0, если она не из этого списка. */
export function pickPosition(paths: string[], current: string | null): number {
  const at = current ? paths.indexOf(current) : -1;
  return at + 1;
}
