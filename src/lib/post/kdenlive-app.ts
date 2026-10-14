import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { findMelt } from "./subtitles";

/*
 * «Открыть в Kdenlive»: запускает Kdenlive на этом компьютере с проектом эпизода.
 * Путь — `KDENLIVE` или kdenlive.exe рядом с melt (та же папка bin).
 */

export function findKdenlive(): string {
  const configured = process.env.KDENLIVE?.trim();
  if (configured && fs.existsSync(configured)) return configured;
  try {
    const melt = findMelt();
    for (const name of ["kdenlive.exe", "kdenlive"]) {
      const candidate = path.join(path.dirname(melt), name);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // ниже — общая ошибка
  }
  throw new Error("Не нашёл Kdenlive: впишите KDENLIVE=C:\\Programs\\kdenlive-…\\bin\\kdenlive.exe в .env.local");
}

/** Отдельный процесс, не ждём его и не держим: доска продолжает работать. */
export function openInKdenlive(project: string): void {
  if (!fs.existsSync(project)) throw new Error(`Нет файла проекта: ${project}`);
  const child = spawn(findKdenlive(), [project], { detached: true, stdio: "ignore", windowsHide: false });
  child.on("error", (error) => console.error("[frameboard] Kdenlive:", error));
  child.unref();
}
