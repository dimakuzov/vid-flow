/**
 * Фоновые циклы доски. Живут в процессе Next (`src/instrumentation.ts`), отдельного воркера нет.
 *
 * Один таймер на имя на весь процесс. При горячей перезагрузке модуль цикла снова вызывает
 * registerLoop с новой функцией: таймер остаётся тот же, а вызывается уже новый код.
 * Следующий проход не начинается, пока не закончился предыдущий.
 */

type LoopFn = () => void | Promise<void>;

interface LoopEntry {
  fn: LoopFn;
  intervalMs: number;
  timer: ReturnType<typeof setInterval>;
  running: boolean;
}

const KEY = "__frameboardLoops";

function loops(): Map<string, LoopEntry> {
  const g = globalThis as typeof globalThis & { [KEY]?: Map<string, LoopEntry> };
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY]!;
}

async function runOnce(entry: LoopEntry): Promise<void> {
  if (entry.running) return;
  entry.running = true;
  try {
    await entry.fn();
  } catch (error) {
    console.error("[frameboard] фоновый цикл:", error);
  } finally {
    entry.running = false;
  }
}

/** Запускает цикл или подменяет его функцию, если цикл с таким именем уже идёт. */
export function registerLoop(name: string, intervalMs: number, fn: LoopFn): void {
  // Тесты и разовые скрипты: циклы не нужны, задания остаются файлами.
  if (process.env.FRAMEBOARD_LOOPS === "off") return;
  const all = loops();
  const existing = all.get(name);
  if (existing) {
    existing.fn = fn;
    if (existing.intervalMs === intervalMs) return;
    clearInterval(existing.timer);
    existing.intervalMs = intervalMs;
    existing.timer = setInterval(() => void runOnce(existing), intervalMs);
    return;
  }
  const entry: LoopEntry = { fn, intervalMs, running: false, timer: undefined as never };
  entry.timer = setInterval(() => void runOnce(entry), intervalMs);
  all.set(name, entry);
  void runOnce(entry);
}

/** Для тестов и выключения. */
export function stopLoop(name: string): void {
  const entry = loops().get(name);
  if (!entry) return;
  clearInterval(entry.timer);
  loops().delete(name);
}

export function loopNames(): string[] {
  return [...loops().keys()];
}
