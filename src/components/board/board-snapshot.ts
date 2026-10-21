/** Последняя таблица эпизода в памяти вкладки: возврат со страницы клетки показывает её сразу, пока сервер собирает свежую. */

import type { BootstrapPreview, SeriesSummary } from "@/lib/series/types";

export interface BoardSnapshot {
  series: SeriesSummary;
  scenario: string;
  rawScenario: string;
  preview: BootstrapPreview;
}

const snapshots = new Map<string, BoardSnapshot>();

export function saveBoardSnapshot(episodeId: string, snapshot: BoardSnapshot): void {
  snapshots.set(episodeId, snapshot);
}

export function readBoardSnapshot(episodeId: string): BoardSnapshot | undefined {
  return snapshots.get(episodeId);
}
