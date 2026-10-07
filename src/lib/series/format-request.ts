import fs from "fs";
import path from "path";
import type { AgentProviderId } from "../contracts/agent-request";
import { rebuildAgentInbox } from "./agent-request";
import { writeText } from "./media";
import { agentInboxRelative, createEpisode, episodeRoot } from "./paths";

/**
 * Разметка сырого сценария в scenario.md (кадры «## s01»).
 * manual — ждёт агента в чате (pending → done ставит агент);
 * ollama / claude — доска сама зовёт модель: pending → running → done | error, затем собирает таблицу.
 */
export interface FormatRequest {
  status: "pending" | "running" | "done" | "error";
  createdAt: string;
  episodeId: string;
  provider?: AgentProviderId;
  model?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  /** Сколько кадров создано в таблице (после done у провайдера доски). */
  shots?: number;
}

function requestJsonPath(root: string): string {
  return path.join(root, "format_request.json");
}

export function readFormatRequest(root: string): FormatRequest | null {
  const file = requestJsonPath(root);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as FormatRequest;
  } catch {
    return null;
  }
}

export function writeFormatRequest(request: FormatRequest): void {
  writeText(requestJsonPath(episodeRoot(request.episodeId)), JSON.stringify(request, null, 2) + "\n");
}

/** Правила разметки: их читает и агент в чате (format_request.md), и модель, которую зовёт доска. */
export const FORMAT_RULES = `Формат \`scenario.md\`:

\`\`\`md
# Название эпизода

## s01 Короткое название
- characters: имя, имя
- location: id_локации
- duration: 6
- speech: Катя: Мама, я дома.
- speech: Мама: Иди ужинать.
Текст действия этого кадра.
\`\`\`

Правила:

- Не выдумывай сюжет. Дели на кадры там, где меняется место, время или непрерывное действие.
- Имена персонажей и локаций бери из текста: нижний регистр, пробелы замени на \`_\`. Если такой персонаж или локация уже есть в библиотеке, пиши ровно это имя.
- Нет персонажей или локации в кадре — оставь поле пустым.
- \`duration\` — длительность клипа в секундах, целое число от 2 до 12. Оцени по действию и репликам: реплике нужно примерно 1 секунда на 2–3 слова плюс секунда на начало и конец. Нет оснований — 5.
- \`speech\` — прямая речь персонажей в этом кадре, дословно, как в сценарии, на языке сценария. Одна реплика — одна строка \`- speech: Имя: текст\`. Голос за кадром, звуки и ремарки — не реплики. Никто не говорит — строк \`speech\` нет.
- Текст действия реплики не повторяет.
- Один кадр — один блок \`## s01\`, \`## s02\` и дальше по порядку.`;

function renderFormatRequestMarkdown(request: FormatRequest): string {
  return `# Отформатировать сценарий

- эпизод: ${request.episodeId}
- статус: ${request.status}
- время: ${request.createdAt}
- сырой текст: scenario_raw.md
- куда записать: scenario.md
- входящие: ${agentInboxRelative(request.episodeId)}

Сырой сценарий лежит в \`scenario_raw.md\` этого эпизода.
Запиши размеченный результат в \`scenario.md\`.
Папки \`shots/\` не создавай. Их соберёт скрипт доски, когда пользователь нажмёт «Создать выбранные».

${FORMAT_RULES}
- Когда \`scenario.md\` записан, поставь в \`format_request.json\` поле \`"status": "done"\`.
`;
}

/**
 * Записывает сырой сценарий и запрос на разметку. Для ollama / claude запрос сразу `pending`
 * для исполнителя доски (startFormatRun), для manual — для агента в чате (agent_inbox.md).
 */
export function submitFormatRequest(
  episodeId: string,
  rawText: string,
  options: { provider?: AgentProviderId; model?: string } = {},
): FormatRequest {
  const text = rawText.trim();
  if (!text) throw new Error("Вставь сырой текст сценария");

  const id = createEpisode(episodeId);
  const root = episodeRoot(id);
  const provider = options.provider ?? "manual";
  const request: FormatRequest = {
    status: "pending",
    createdAt: new Date().toISOString(),
    episodeId: id,
    provider,
    model: provider === "manual" ? undefined : options.model?.trim() || undefined,
  };
  writeText(path.join(root, "scenario_raw.md"), `${text}\n`);
  writeFormatRequest(request);
  writeText(path.join(root, "format_request.md"), renderFormatRequestMarkdown(request));
  rebuildAgentInbox(id);
  return request;
}
