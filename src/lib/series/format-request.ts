import fs from "fs";
import path from "path";
import { rebuildAgentInbox } from "./agent-request";
import { writeText } from "./media";
import { agentInboxRelative, ensureEpisode, episodeDir } from "./paths";

export interface FormatRequest {
  status: "pending" | "done";
  createdAt: string;
  episodeId: string;
}

function requestJsonPath(episodeRoot: string): string {
  return path.join(episodeRoot, "format_request.json");
}

export function readFormatRequest(episodeRoot: string): FormatRequest | null {
  const file = requestJsonPath(episodeRoot);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as FormatRequest;
  } catch {
    return null;
  }
}

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

Формат \`scenario.md\`:

\`\`\`md
# Название эпизода

## s01 Короткое название
- characters: имя, имя
- location: id_локации
Текст действия этого кадра.
\`\`\`

Правила:

- Не выдумывай сюжет. Дели на кадры там, где меняется место, время или непрерывное действие.
- Имена персонажей и локаций бери из текста: нижний регистр, пробелы замени на \`_\`.
- Один кадр — один блок \`## s01\`, \`## s02\` и дальше по порядку.
- Когда \`scenario.md\` записан, поставь в \`format_request.json\` поле \`"status": "done"\`.
`;
}

export function submitFormatRequest(episodeId: string, rawText: string): FormatRequest {
  const text = rawText.trim();
  if (!text) throw new Error("Вставь сырой текст сценария");

  const id = ensureEpisode(episodeId);
  const root = episodeDir(id);
  const request: FormatRequest = {
    status: "pending",
    createdAt: new Date().toISOString(),
    episodeId: id,
  };
  writeText(path.join(root, "scenario_raw.md"), `${text}\n`);
  writeText(requestJsonPath(root), JSON.stringify(request, null, 2) + "\n");
  writeText(path.join(root, "format_request.md"), renderFormatRequestMarkdown(request));
  rebuildAgentInbox();
  return request;
}
