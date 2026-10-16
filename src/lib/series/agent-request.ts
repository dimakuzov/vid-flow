import fs from "fs";
import path from "path";
import type {
  AgentMode,
  AgentProviderId,
  AgentRequestFile,
  AgentRequestStatus,
  RefFingerprint,
} from "../contracts/agent-request";
import type { WorkflowChoice } from "../contracts/graph-binding";
import { listWorkflowChoices, resolveWorkflowId } from "../comfy/workflows";
import { currentClaudeModel, defaultProviderId, isProviderId } from "../agent/config";
import {
  BASELINE_FILE,
  LLM_TASK,
  REQUEST_JSON,
  TOUCH_FILE,
  fingerprintRefs,
  readAgentDispatch,
  readAgentRequest,
  readBaseline,
  readTouch,
  writeAgentDispatch,
  writeAgentRequest,
  type AgentBaseline,
  type AgentComfyState,
  type AgentDispatch,
} from "../agent/files";
import { getAgentProvider } from "../agent/providers";
import { chosenDurationSec, durationTaskLine, renderGraphImages } from "../agent/task";
import { startAgentRun } from "../agent/runner";
import { STAGES, type StageId } from "./constants";
import { readTextIfExists, writeText } from "./media";
import { updateStageDocs } from "./mutations";
import { excludedFiles } from "./run-settings";
import { readShotMeta } from "./shot-meta";
import { appendShotNote } from "./shot-notes";
import { renderShotContext } from "../agent/shot-context";
import { readShotSpeech, SPEECH_FILE, stageHasSpeech } from "./speech";
import { assertStageFree, writeStageState } from "./stage-state";
import {
  agentInboxRelative,
  assertSafeSegment,
  episodeRoot,
  getCharactersRoot,
  listShotIds,
  stageDir,
} from "./paths";

/** Устаревшая копия задачи. Новые запросы её не пишут, старую убирают при отправке. */
const LEGACY_REQUEST_MD = "agent_request.md";

// Схема запроса — docs/contracts/agent-request.md.
export type { AgentRequestFile, RefFingerprint, AgentBaseline, AgentComfyState, AgentDispatch };
export { readAgentRequest, readAgentDispatch, writeAgentDispatch };

export interface AgentRequestSummary {
  status: AgentRequestStatus;
  createdAt: string;
  refsChangedByUser: boolean;
  provider: AgentProviderId | null;
  error: string | null;
  suggestedWorkflow: string | null;
  comfy: AgentComfyState | null;
  comfyJobId: string | null;
  comfyError: string | null;
}

function textChange(
  baseline: AgentBaseline | null,
  key: "prompt" | "refsNote" | "workflowNote",
  current: string,
): "changed" | "unchanged" | "no-baseline" {
  if (!baseline) return "no-baseline";
  return baseline[key] === current ? "unchanged" : "changed";
}

function readPendingFormatRequest(
  root: string,
): { episodeId: string; createdAt: string } | null {
  const file = path.join(root, "format_request.json");
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
      status?: string;
      episodeId?: string;
      createdAt?: string;
      provider?: string;
    };
    if (data.status !== "pending" || !data.episodeId) return null;
    // Разметку моделью доска делает сама: во входящие агенту в чате она не попадает.
    if (data.provider && data.provider !== "manual") return null;
    return { episodeId: data.episodeId, createdAt: data.createdAt || "" };
  } catch {
    return null;
  }
}

export function readAgentRequestSummary(
  episodeId: string,
  shotId: string,
  stageId: StageId,
): AgentRequestSummary | null {
  const request = readAgentRequest(episodeId, shotId, stageId);
  if (!request) return null;
  const dispatch = readAgentDispatch(episodeId, shotId, stageId);
  return {
    status: request.status,
    createdAt: request.createdAt,
    refsChangedByUser: request.refsChangedByUser,
    provider: request.provider ?? null,
    error: request.error ?? null,
    suggestedWorkflow: request.suggestedWorkflow ?? null,
    comfy: dispatch?.state ?? null,
    comfyJobId: dispatch?.jobId ?? null,
    comfyError: dispatch?.error ?? null,
  };
}

/** Оглавление для ручного режима: только запросы, которые ждут агента в чате. */
export function rebuildAgentInbox(episodeId: string): void {
  const root = episodeRoot(episodeId);
  const lines = [
    "# Входящие агенту",
    "",
    "Запросы со статусом `pending` для агента в чате. Задача целиком — в `llm_task.md` папки этапа. Единственный сигнал доске — `\"status\": \"done\"` в `agent_request.json`.",
    "",
  ];
  let pending = 0;

  const formatRequest = readPendingFormatRequest(root);
  if (formatRequest) {
    pending += 1;
    lines.push("## format-scenario");
    lines.push(`- эпизод: ${formatRequest.episodeId}`);
    lines.push(`- время: ${formatRequest.createdAt}`);
    lines.push("- задача: format_request.md");
    lines.push("");
  }

  for (const shotId of listShotIds(episodeId)) {
    for (const stageId of STAGES) {
      const request = readAgentRequest(episodeId, shotId, stageId);
      if (!request || request.status !== "pending") continue;
      // Ollama и claude запускает сама доска: во входящих их нет.
      if ((request.provider ?? "manual") !== "manual") continue;
      pending += 1;
      const preview = request.message.trim().split(/\r?\n/)[0] || "(пусто)";
      lines.push(`## ${shotId} · ${stageId}`);
      lines.push(`- время: ${request.createdAt}`);
      lines.push(`- сообщение: ${preview}`);
      lines.push(`- задача: shots/${shotId}/${stageId}/${LLM_TASK}`);
      lines.push("");
    }
  }

  if (!pending) {
    lines.push("Пусто.");
    lines.push("");
  } else {
    lines.push(`Файл входящих: ${agentInboxRelative(episodeId)}.`);
    lines.push("");
  }

  writeText(path.join(root, "agent_inbox.md"), lines.join("\n"));
}

function listFileNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => {
      try {
        return fs.statSync(path.join(dir, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b));
}

function bulletFiles(dir: string): string {
  const names = listFileNames(dir);
  return names.length ? names.map((name) => `- ${name}`).join("\n") : "- (пусто)";
}

function bulletList(items: string[]): string {
  return items.length ? items.join(", ") : "нет";
}

function textOrEmpty(value: string): string {
  return value.trim() || "(пусто)";
}

function renderWorkflows(choices: WorkflowChoice[], selected: string | null): string {
  if (!choices.length) return "У этапа нет воркфлоу доски: этап делает агент сам, по плейбуку.";
  const lines = choices.map((choice) => {
    const marks = [
      choice.id === selected ? "выбран" : null,
      choice.available ? null : `не хватает: ${choice.missing.join(", ")}`,
    ].filter(Boolean);
    const playbook = choice.playbook ? `, плейбук модели \`playbooks/${choice.playbook}\`` : "";
    return `- \`${choice.id}\` — ${choice.label}${playbook}${marks.length ? ` (${marks.join("; ")})` : ""}`;
  });
  return `${lines.join("\n")}

Если другой вариант подходит лучше, впиши его id в поле \`suggestedWorkflow\` файла \`${REQUEST_JSON}\`. Доска покажет предложение и сама не переключит.`;
}

/** Реплики кадра для видео-этапов: раздел с пустой строкой после него, иначе пусто. */
function renderSpeech(episodeId: string, shotId: string, stageId: StageId): string {
  if (!stageHasSpeech(stageId)) return "";
  const speech = readShotSpeech(episodeId, shotId).trim();
  const body = speech
    ? `${speech}\n\nРеплика уже на английском переносится в prompt.md дословно. Реплика по-русски пишется по-английски: кириллицу не копировать и на русский не переводить. Имя перед двоеточием в prompt.md не писать — говорящий там character1, character2.`
    : "Пусто: в кадре никто не говорит.";
  return `## Реплики (shots/${shotId}/${SPEECH_FILE})\n\n${body}\n\n`;
}

/** Длительность из меню этапа (бриф 03): строка с пустой строкой перед ней, иначе пусто. */
function renderDuration(episodeId: string, shotId: string, stageId: StageId, workflow: string | null): string {
  const seconds = chosenDurationSec(episodeId, shotId, stageId, workflow);
  return seconds == null
    ? ""
    : `\n${durationTaskLine(seconds)} Длительность доска ставит сама: \`N sec\` в prompt.md не пиши.\n`;
}

/** Файлы, убранные пользователем из графа этапа: блок с пустой строкой перед ним, иначе пусто. */
function renderExcluded(episodeId: string, shotId: string, stageId: StageId): string {
  const excluded = [...excludedFiles(episodeId, shotId, stageId)];
  if (!excluded.length) return "";
  return `
### Убрано пользователем из графа

Файлы остаются на диске, но граф их не получает. Не используй их, не считай в номерах картинок, не удаляй и не возвращай:

${excluded.map((item) => `- \`data/${item}\``).join("\n")}
`;
}

/** Правила prompt.md последних трёх этапов: блок с пустой строкой после него, иначе пусто. */
function renderPromptRules(stageId: StageId): string {
  if (stageId !== "first_frame" && stageId !== "video_preview" && stageId !== "final_render") return "";
  return `## Правила prompt.md

Эти правила важнее плейбука, если он говорит иначе. Они одни для всех воркфлоу этого этапа.

\`prompt.md\` всегда на английском. Кириллицы в нём нет. На русский ничего не переводить, в том числе реплики: реплику пиши по-английски, даже если в speech.md она по-русски.

Люди в промпте — character1, character2, character3, в порядке их референсов (как в списке «Images the graph receives»; если списка нет — по алфавиту имён из строки персонажей, чтобы на всех этапах у человека был один номер). Имена из сообщения, shot.md и имён файлов нужны только чтобы понять, о ком речь. В prompt.md их не писать. Пример в плейбуке с Julia или Lena — старая форма: пиши character1 и character2.

Каждого опиши одним-двумя предложениями, чтобы модель отличала людей, без имени из задачи. Если у человека есть референсы, в тех же предложениях привяжи их: \`character1 is image 2 and the face from image 4\`. Номера — из списка картинок. Где плейбук пишет \`@img-N\`, используй эту метку так же.

\`prompt.md\` — вся инструкция этого запуска. Не ссылаться на прошлый промпт и прошлый результат и не писать «как раньше», «оставь всё как было», «the same as last time» вместо текста. Если пользователь просит одно изменение («всё хорошо, добавь пакет в руки Ивану»), заново выпиши прошлый промпт целиком и добавь это изменение: пакет в руках того, кто в задаче Иван, под его номером characterN. Не пиши фразу, что нужно повторить прошлый результат. \`exactly as in image N\` — это про референс, так и оставляй.

`;
}

/** Замечания, действие кадра и описания картинок: блок с пустой строкой после него, иначе пусто. */
function renderContext(request: AgentRequestFile): string {
  const text = renderShotContext(request.episodeId, request.shotId, request.stageId, request.createdAt);
  return text ? `${text}

` : "";
}

/** Номера картинок графа первого кадра (`image N`): блок с пустой строкой перед ним, иначе пусто. */
function renderImages(episodeId: string, shotId: string, stageId: StageId, workflow: string | null): string {
  const text = renderGraphImages(episodeId, shotId, stageId, workflow);
  return text ? `\n${text.replace(/^## /, "### ")}\n` : "";
}

/** Выбор воркфлоу без ошибок: неизвестное имя — вариант по умолчанию. */
function safeWorkflowId(episodeId: string, shotId: string, stageId: StageId, requested?: string): string | null {
  try {
    return resolveWorkflowId(episodeId, shotId, stageId, requested);
  } catch {
    return resolveWorkflowId(episodeId, shotId, stageId, null);
  }
}

/** `llm_task.md` — единственный самодостаточный текст задачи (для agent и manual). */
function renderLlmTask(request: AgentRequestFile, boardQueues: boolean, workflow?: string): string {
  const { episodeId, shotId, stageId } = request;
  const dir = stageDir(episodeId, shotId, stageId);
  const meta = readShotMeta(episodeId, shotId);
  const choices = listWorkflowChoices(episodeId, shotId, stageId);
  const selected = choices.length ? safeWorkflowId(episodeId, shotId, stageId, workflow) : null;
  const libraries = meta.characters.length
    ? meta.characters
        .map((name) => `### data/characters/${name}/\n\n${bulletFiles(path.join(getCharactersRoot(), name))}`)
        .join("\n\n")
    : "(в shot.md персонажи не указаны)";

  const refsRule = request.refsChangedByUser
    ? "Пользователь сам менял `refs/` после прошлого прохода. Файлы в `refs/` оставь как есть."
    : "Файлы в `refs/` пересобирай, только если из сообщения следует, что текущие референсы не те.";

  let work: string;
  if (stageId === "characters") {
    work = `Персонажи этого кадра: ${bulletList(meta.characters)}. Перепиши \`prompt.md\`: каждому — свой раздел \`## имя\` строчными латинскими буквами (как имя в shot.md). Пустой раздел — этого персонажа доска не перегенерирует. Текст до первого заголовка и неизвестное имя раздела — ошибка.

Image 1 — база: файл пользователя \`refs/{имя}_base.*\`, если он его положил, иначе библиотека. Image 2 — образец одежды \`refs/{имя}_clothes.*\`, если пользователь его положил. Нет образца — нода «image 2: образец одежды» в bypass, одежду опиши текстом и image 2 не упоминай. Другие файлы \`refs/\` в этот граф не входят. Одежда в тексте — только из сообщения пользователя. Лицо, волосы, фигура, поза, фон и остальная одежда — как на image 1. Внешность по памяти не описывай. Имена персонажей в текст модели не пиши.

В ComfyUI ничего не ставь и в \`approve/\` ничего не клади. После done доска сама запустит по прогону на персонажа, файлы появятся в \`output/\`. Утверждает пользователь.`;
  } else if (boardQueues) {
    work = `Перепиши \`prompt.md\` по сообщению пользователя и плейбуку модели выбранного воркфлоу. \`prompt.md\` — ровно тот текст, который уйдёт в модель. Прошлую версию доска сохранит сама.

В ComfyUI ничего не ставь: после done доска сама запустит этап выбранным воркфлоу.`;
  } else if (stageId === "first_frame") {
    work = `Утверждённых персонажей и локации для графа сборки нет, поэтому этап делаешь ты. Если в shot.md нет персонажей и локации или пользователь просит кадр сразу, не жди \`characters/approve\` и \`location/approve\` и не создавай эти этапы. Имя человека и название места, которых нет в сообщении, не выдумывай. Собери картинку по тексту кадра и файлам в \`refs/\`, результат положи в \`output/\`, в \`approve/\` — только выбранный файл. Правило — \`playbooks/stages/first_frame.en.md\`, раздел о кадре без персонажа и локации.`;
  } else {
    work = `Сделай этап по плейбуку \`playbooks/stages/${stageId}.en.md\` (если его нет — \`${stageId}.md\`). Результаты клади в \`output/\`.`;
  }

  const comfy = boardQueues
    ? ""
    : `
## ComfyUI

ComfyUI — \`http://127.0.0.1:8188/\` на компьютере с папкой проекта. Если эта оболочка его не видит, поставь задание файлом \`data/comfy_queue/<id>.json\` (\`status: pending\`, формат — \`docs/contracts/comfy-job.md\`) и жди в нём \`status: done\`. Без разрешения пользователя модели не меняй и не скачивай.
`;

  return `# Задача агенту: ${shotId} · ${stageId}

Это вся задача. Других инструкций не будет: \`git pull\` не нужен, файлы уже на диске.

- эпизод: ${episodeId}
- кадр: ${shotId}
- этап: ${stageId}
- папка этапа: \`${dir}\`
- запрос: ${request.id}, ${request.createdAt}

Работай только в папке этого этапа. Другие кадры не открывай. \`data/\` не коммить.

## Сообщение пользователя

${request.message.trim()}

## Кадр (shot.md)

**${meta.title}**

${meta.summary || "(действие кадра не описано)"}

- персонажи: ${bulletList(meta.characters)}
- локация: ${meta.location || "нет"}

Это исходный текст сценария, написанный до картинок. Если он расходится с картинками или замечаниями ниже, верны они.

${renderContext(request)}${renderPromptRules(stageId)}${renderSpeech(episodeId, shotId, stageId)}## Воркфлоу этапа

${renderWorkflows(choices, selected)}
${renderDuration(episodeId, shotId, stageId, selected)}${renderImages(episodeId, shotId, stageId, boardQueues ? selected : null)}
## Что сделать

${work}

${refsRule}

## Текущие документы этапа

### prompt.md

${textOrEmpty(request.current.prompt)}

### refs.md

${textOrEmpty(request.current.refsNote)}

### workflow.md

${textOrEmpty(request.current.workflowNote)}

## Файлы этапа

Изменения с прошлого прохода агента: prompt.md — ${request.changes.prompt}, refs.md — ${request.changes.refsNote}, workflow.md — ${request.changes.workflowNote}; в refs/ добавлены: ${bulletList(request.changes.refFilesAdded)}; удалены: ${bulletList(request.changes.refFilesRemoved)}; заменены: ${bulletList(request.changes.refFilesReplaced)}.

### refs/

${bulletFiles(path.join(dir, "refs"))}
${renderExcluded(episodeId, shotId, stageId)}
### output/

${bulletFiles(path.join(dir, "output"))}

### approve/

${bulletFiles(path.join(dir, "approve"))}

## База персонажей

${libraries}
${comfy}
## Что можно менять

\`prompt.md\`, \`refs/\` (по правилу выше), \`refs.md\`, \`workflow.md\`, \`output/\` и \`approve/\` (только добавлять), \`run_log.md\` (только дописывать), \`${BASELINE_FILE}\`, \`${TOUCH_FILE}\` и поля \`status\` и \`suggestedWorkflow\` в \`${REQUEST_JSON}\`. Остальные файлы папки ведёт доска.

## Когда закончишь

1. Запиши \`${BASELINE_FILE}\`: \`capturedAt\`, \`prompt\`, \`refsNote\`, \`workflowNote\` и \`refs\` (\`name\`, \`sha256\`, \`bytes\` каждого файла в \`refs/\`).
2. Запиши \`${TOUCH_FILE}\`: \`{ "refsTouchedByUser": false }\`.
3. Если гонял генерацию, допиши заметку в \`run_log.md\`.
4. Последней записью поставь \`"status": "done"\` в \`${REQUEST_JSON}\`. Это единственный сигнал доске.
`;
}

/** Доска запускает этап сама: у него есть доступный вариант воркфлоу (манифест). */
export function stageBoardQueues(episodeId: string, shotId: string, stageId: StageId): boolean {
  return listWorkflowChoices(episodeId, shotId, stageId).some((choice) => choice.available);
}

const MODE_TEXT: Record<AgentMode, string> = {
  text: "переписать промпт (text)",
  agent: "сделать этап самому (agent)",
  manual: "ручной режим",
};

/** Режим запроса: manual для ручного провайдера; text, если этап запускает доска; иначе agent. */
export function agentModeFor(providerId: AgentProviderId, boardQueues: boolean): AgentMode {
  if (providerId === "manual") return "manual";
  return boardQueues ? "text" : "agent";
}

export function submitAgentRequest(options: {
  episodeId: string;
  shotId: string;
  stageId: StageId;
  message: string;
  prompt: string;
  refsNote: string;
  workflowNote: string;
  /** id манифеста или старое имя (i2v, flf). Нет — выбор этапа. */
  workflow?: string;
  /** Кто исполняет. Нет — FRAMEBOARD_AGENT_PROVIDER, иначе manual. */
  provider?: string;
  /** Модель провайдера. Нет — модель провайдера по умолчанию. */
  model?: string;
  /** Разрешение на платный запуск в Comfy Cloud после ответа агента (один запуск). */
  allowCloud?: boolean;
  /** Сколько файлов с тем же промптом и разными seed. Нет и финал — один. */
  takes?: number;
  /** Сообщение написала доска (массовый запуск), а не пользователь: в замечания кадра не идёт. */
  auto?: boolean;
}): AgentRequestFile {
  const episodeId = options.episodeId;
  const shotId = assertSafeSegment(options.shotId, "shot");
  const stageId = options.stageId;

  const providerId = options.provider?.trim() || defaultProviderId();
  if (!isProviderId(providerId)) throw new Error(`Неизвестный провайдер агента «${providerId}»`);
  const provider = getAgentProvider(providerId);
  assertStageFree(episodeId, shotId, stageId);

  const boardQueues = stageBoardQueues(episodeId, shotId, stageId);
  const mode = agentModeFor(providerId, boardQueues);
  if (!provider.modes.includes(mode)) {
    throw new Error(
      `${provider.label} не подходит для этапа ${stageId}: нужно ${MODE_TEXT[mode]}, а провайдер умеет только ${provider.modes
        .map((item) => MODE_TEXT[item])
        .join(", ")}. Выбери Claude или ручной режим.`,
    );
  }
  const typedModel = options.model?.trim() || undefined;
  const model = providerId === "claude" ? currentClaudeModel(typedModel) : typedModel;
  const configError = provider.configError?.(model);
  if (configError) throw new Error(configError);
  const workflow = options.workflow?.trim() || undefined;
  // Неизвестный воркфлоу — ошибка сразу, а не после ответа агента.
  if (workflow) resolveWorkflowId(episodeId, shotId, stageId, workflow);

  const typed = options.message.trim();
  const message = typed || "Сгенерируй по текущим документам этапа.";

  const baseline = readBaseline(episodeId, shotId, stageId);
  const touched = readTouch(episodeId, shotId, stageId);
  const currentRefs = fingerprintRefs(episodeId, shotId, stageId);

  updateStageDocs({
    episodeId,
    shotId,
    stageId,
    prompt: options.prompt,
    // Рекомендация уходит в agent_request.json. Поле ввода очищается сразу,
    // чтобы старая правка не попала ни агенту, ни в модель повторно.
    llmNotes: "",
    refs: options.refsNote,
    workflow: options.workflowNote,
  });

  const baseRefs = new Map((baseline?.refs ?? []).map((file) => [file.name, file.sha256]));
  const currentMap = new Map(currentRefs.map((file) => [file.name, file.sha256]));
  const refFilesAdded = currentRefs.filter((file) => !baseRefs.has(file.name)).map((file) => file.name);
  const refFilesRemoved = [...baseRefs.keys()].filter((name) => !currentMap.has(name));
  const refFilesReplaced = currentRefs
    .filter((file) => baseRefs.has(file.name) && baseRefs.get(file.name) !== file.sha256)
    .map((file) => file.name);
  const refsDifferFromBaseline = baseline
    ? refFilesAdded.length > 0 || refFilesRemoved.length > 0 || refFilesReplaced.length > 0
    : false;
  const refsChangedByUser = touched || refsDifferFromBaseline;

  const createdAt = new Date().toISOString();
  // Замечание пользователя остаётся в истории кадра: поле «Рекомендация» уже очищено.
  if (typed && !options.auto) appendShotNote(episodeId, shotId, stageId, typed, createdAt);

  const request: AgentRequestFile = {
    id: `${shotId}-${stageId}-${Date.now()}`,
    episodeId,
    shotId,
    stageId,
    createdAt,
    status: "pending",
    message,
    refsChangedByUser,
    provider: providerId,
    model: providerId === "manual" ? undefined : model,
    mode,
    changes: {
      prompt: textChange(baseline, "prompt", options.prompt),
      refsNote: textChange(baseline, "refsNote", options.refsNote),
      workflowNote: textChange(baseline, "workflowNote", options.workflowNote),
      refFilesAdded: baseline ? refFilesAdded : [],
      refFilesRemoved: baseline ? refFilesRemoved : [],
      refFilesReplaced: baseline ? refFilesReplaced : [],
    },
    current: {
      prompt: options.prompt,
      refsNote: options.refsNote,
      workflowNote: options.workflowNote,
      refFiles: currentRefs,
    },
  };

  const dir = stageDir(episodeId, shotId, stageId);
  writeAgentDispatch(episodeId, shotId, stageId, {
    requestId: request.id,
    state: boardQueues ? "wait" : "agent",
    workflow,
    ...(options.allowCloud ? { allowCloud: true } : {}),
    ...(options.takes && options.takes > 1 ? { takes: options.takes } : {}),
    updatedAt: request.createdAt,
  });
  writeAgentRequest(request);
  writeText(path.join(dir, LLM_TASK), renderLlmTask(request, boardQueues, workflow));
  fs.rmSync(path.join(dir, LEGACY_REQUEST_MD), { force: true });
  writeStageState(episodeId, shotId, stageId, {
    phase: "agent",
    requestId: request.id,
    agentRunsComfy: !boardQueues,
    since: request.createdAt,
  });
  rebuildAgentInbox(episodeId);
  // text / agent: провайдер запускается в фоне. Ошибку он пишет в agent_request.json сам.
  if (mode !== "manual") void startAgentRun(episodeId, shotId, stageId);
  return request;
}

/** Отмечает запрос отменённым (pending или running). Фазу этапа и прерывание исполнителя делает вызывающий код. */
export function cancelAgentRequest(episodeId: string, shotId: string, stageId: StageId): AgentRequestFile | null {
  const request = readAgentRequest(episodeId, shotId, stageId);
  if (!request || (request.status !== "pending" && request.status !== "running")) return null;
  const cancelled: AgentRequestFile = { ...request, status: "cancelled", finishedAt: new Date().toISOString() };
  writeAgentRequest(cancelled);
  const dispatch = readAgentDispatch(episodeId, shotId, stageId);
  if (dispatch && dispatch.requestId === request.id) {
    writeAgentDispatch(episodeId, shotId, stageId, {
      ...dispatch,
      state: "cancelled",
      updatedAt: new Date().toISOString(),
    });
  }
  rebuildAgentInbox(episodeId);
  return cancelled;
}

/** Текст llm_task.md этапа. */
export function readLlmTask(episodeId: string, shotId: string, stageId: StageId): string {
  return readTextIfExists(path.join(stageDir(episodeId, shotId, stageId), LLM_TASK));
}
