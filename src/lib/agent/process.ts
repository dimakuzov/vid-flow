import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";

/** Ищет исполняемый файл без запуска: абсолютный путь или поиск по PATH (с PATHEXT на Windows). */
export function resolveExecutable(command: string): string | null {
  const isWin = process.platform === "win32";
  const exts = isWin
    ? ["", ...(process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean).map((e) => e.toLowerCase())]
    : [""];
  const candidates = (base: string) => exts.map((ext) => base + ext);
  const isFile = (file: string) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  };

  if (path.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return candidates(path.resolve(command)).find(isFile) ?? null;
  }
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const found = candidates(path.join(dir, command)).find(isFile);
    if (found) return found;
  }
  return null;
}

/** Убивает процесс вместе с дочерними. */
export function killTree(pid: number): void {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      // Процесс запущен с detached: true — у него своя группа, отрицательный pid убивает всю группу.
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // Процесс уже вышел.
  }
}

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Запускает процесс, пишет stdin, ждёт выхода. Abort убивает дерево процессов и отклоняет промис
 * с `signal.reason`. Файлы .cmd/.bat на Windows запускаются через оболочку: аргументы в кавычках,
 * поэтому в них не должно быть двойных кавычек.
 */
export function runProcess(
  file: string,
  args: string[],
  options: { cwd: string; stdin?: string; signal: AbortSignal; env?: NodeJS.ProcessEnv },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(options.signal.reason);
      return;
    }
    const viaShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(file);
    if (viaShell && args.some((arg) => arg.includes('"'))) {
      reject(new Error("Аргумент с кавычками нельзя передать в .cmd"));
      return;
    }
    const child = viaShell
      ? spawn(`"${file}"`, args.map((arg) => `"${arg}"`), {
          cwd: options.cwd,
          env: options.env ?? process.env,
          shell: true,
          windowsHide: true,
        })
      : spawn(file, args, {
          cwd: options.cwd,
          env: options.env ?? process.env,
          detached: process.platform !== "win32",
          windowsHide: true,
        });

    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.on("data", (chunk: string) => (stderr += chunk));

    const onAbort = () => {
      if (child.pid) killTree(child.pid);
      if (!settled) {
        settled = true;
        reject(options.signal.reason);
      }
    };
    options.signal.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => {
      options.signal.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      options.signal.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr });
    });

    if (options.stdin !== undefined) {
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(options.stdin, "utf8");
    } else {
      child.stdin?.end();
    }
  });
}
