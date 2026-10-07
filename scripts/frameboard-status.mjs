#!/usr/bin/env node
/*
 * Строка состояния Claude Code: сколько агентов доски работает и ждёт очереди.
 * Claude Code присылает JSON сессии на stdin и показывает то, что скрипт печатает в stdout
 * (https://code.claude.com/docs/en/statusline). Без зависимостей: встроенный fetch Node.
 *
 *   echo '{}' | FRAMEBOARD_PORT=3456 node scripts/frameboard-status.mjs
 *
 * Код выхода всегда 0: при ненулевом Claude Code гасит строку.
 */

const TIMEOUT_MS = 500;

/** 1 работает, 2 работают, 21 работает. */
function working(count) {
  return count % 10 === 1 && count % 100 !== 11 ? "работает" : "работают";
}

function formatStatus(runs) {
  const running = Array.isArray(runs?.running) ? runs.running.length : 0;
  const queued = Array.isArray(runs?.queued) ? runs.queued.length : 0;
  if (running === 0 && queued === 0) return "Frameboard: агентов нет";
  return `Frameboard: ${running} ${working(running)} · ${queued} в очереди`;
}

async function main() {
  // JSON сессии не нужен, но stdin читаем, чтобы Claude Code не упёрся в закрытую трубу.
  if (!process.stdin.isTTY) process.stdin.resume().on("error", () => undefined);

  const port = process.env.FRAMEBOARD_PORT?.trim() || "3456";
  let line;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/agent/runs`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    line = response.ok ? formatStatus(await response.json()) : `Frameboard: ошибка доски (${response.status})`;
  } catch {
    line = "Frameboard: доска выключена";
  }
  process.stdout.write(`${line}\n`, () => process.exit(0));
}

void main();
