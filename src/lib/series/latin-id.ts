/**
 * Id задания и имя файла ComfyUI: латиница, цифры, точка, _ и -.
 * Название кадра может быть русским, папка тоже; в очередь уходит эта форма.
 */
const CYRILLIC: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

export function latinToken(value: string): string {
  let out = "";
  for (const char of value.toLowerCase()) out += CYRILLIC[char] ?? char;
  out = out
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (!out) out = "shot";
  return out.slice(0, 40);
}
