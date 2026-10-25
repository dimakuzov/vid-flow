/**
 * Как нажали «Убрать»/«Вернуть»: мышью (detail ≥ 1), с клавиатуры Enter или пробелом (detail 0),
 * настоящим действием человека (trusted) или скриптом. Уходит в журнал run_settings.log,
 * чтобы по следу было видно, откуда пришла правка.
 */
export interface ClickTrace {
  trusted: boolean;
  detail: number;
  at: string;
}

let last: ClickTrace | null = null;

export function rememberClick(event: { isTrusted: boolean; detail: number }): void {
  last = { trusted: event.isTrusted, detail: event.detail, at: new Date().toISOString() };
}

export function lastClick(): ClickTrace | null {
  return last;
}
