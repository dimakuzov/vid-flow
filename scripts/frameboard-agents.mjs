#!/usr/bin/env node
/*
 * Агенты доски из терминала и из сессии Claude Code (`! npm run agents -- list`).
 *
 *   npm run agents -- list                     таблица: кто работает, кто ждёт
 *   npm run agents -- stop e01/s03/location    остановить один прогон (как «Отменить»)
 *   npm run agents -- stop e01/format         остановить разметку сценария эпизода
 *   npm run agents -- stop --all               остановить все работающие и ждущие
 *
 * Порт доски — FRAMEBOARD_PORT (по умолчанию 3456). Без зависимостей.
 */

const TIMEOUT_MS = 5000;
const USAGE = `Использование:
  npm run agents -- list
  npm run agents -- stop <эпизод>/<кадр>/<этап>
  npm run agents -- stop <эпизод>/format
  npm run agents -- stop --all`;

function base() {
  return `http://127.0.0.1:${process.env.FRAMEBOARD_PORT?.trim() || "3456"}`;
}

async function call(path, init) {
  let response;
  try {
    response = await fetch(`${base()}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Error(`Доска не отвечает на ${base()}. Запущен ли npm run dev? Порт — FRAMEBOARD_PORT.`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Доска ответила ${response.status}`);
  return body;
}

function where(run) {
  return run.kind === "format" ? `${run.episodeId} · разметка сценария` : `${run.episodeId}/${run.shotId}/${run.stageId}`;
}

function ago(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return `${Math.max(0, Math.floor(ms / 1000))} с`;
  if (minutes < 60) return `${minutes} мин`;
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  return rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd()).join("\n");
}

function printRuns({ running = [], queued = [] }) {
  if (running.length === 0 && queued.length === 0) {
    console.log("Агентов доски нет.");
    return;
  }
  const rows = [["Статус", "Где", "Провайдер", "Модель", "Сколько"]];
  for (const run of running) rows.push(["работает", where(run), run.provider, run.model || "—", ago(run.since)]);
  for (const run of queued) rows.push(["в очереди", where(run), run.provider, run.model || "—", ago(run.since)]);
  console.log(table(rows));
  console.log(`\nРаботают: ${running.length} · в очереди: ${queued.length}`);
}

async function main(argv) {
  const [command, arg] = argv;
  if (command === "list" || command === undefined) {
    printRuns(await call("/api/agent/runs"));
    return 0;
  }
  if (command === "stop") {
    let body;
    if (arg === "--all") body = { all: true };
    else {
      const parts = (arg || "").split("/");
      if (parts.length === 2 && parts[0] && parts[1] === "format") body = { episodeId: parts[0], format: true };
      else if (parts.length !== 3 || parts.some((part) => !part)) {
        console.error(USAGE);
        return 2;
      } else {
        const [episodeId, shotId, stageId] = parts;
        body = { episodeId, shotId, stageId };
      }
    }
    const result = await call("/api/agent/runs/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (result.stopped.length === 0) console.log("Останавливать нечего: здесь агент доски не ждёт и не работает.");
    for (const run of result.stopped) console.log(`Остановлен: ${where(run)} (${run.provider})`);
    console.log("");
    printRuns(result);
    return 0;
  }
  console.error(USAGE);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
