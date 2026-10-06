/**
 * Метаданные ComfyUI из PNG: чанки tEXt/iTXt `prompt` (граф в формате API) и `workflow`.
 * Чтение в браузере, без сервера. Сжатые iTXt (zTXt) ComfyUI не пишет — пропускаются.
 */

export interface PngTextChunks {
  [key: string]: string;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function readPngTextChunks(buffer: ArrayBuffer): PngTextChunks {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) return {};
  const view = new DataView(buffer);
  const latin1 = new TextDecoder("latin1");
  const utf8 = new TextDecoder("utf-8");
  const chunks: PngTextChunks = {};
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = latin1.decode(bytes.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) break;
    const data = bytes.subarray(start, end);
    if (type === "tEXt") {
      const zero = data.indexOf(0);
      if (zero > 0) chunks[latin1.decode(data.subarray(0, zero))] = utf8.decode(data.subarray(zero + 1));
    } else if (type === "iTXt") {
      // keyword \0 compressionFlag compressionMethod languageTag \0 translatedKeyword \0 text
      const zero = data.indexOf(0);
      if (zero > 0 && data[zero + 1] === 0) {
        const lang = data.indexOf(0, zero + 3);
        const translated = lang === -1 ? -1 : data.indexOf(0, lang + 1);
        if (translated !== -1) {
          chunks[latin1.decode(data.subarray(0, zero))] = utf8.decode(data.subarray(translated + 1));
        }
      }
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4; // CRC
  }
  return chunks;
}

export interface ComfyRunContext {
  /** Тексты промптов: строковые входы `text`/`prompt`/... в нодах графа. */
  texts: { node: string; classType: string; field: string; text: string }[];
  /** Seed по нодам. */
  seeds: { node: string; classType: string; field: string; value: number }[];
  hasWorkflow: boolean;
}

const TEXT_FIELDS = new Set(["text", "prompt", "positive_prompt", "text_g", "text_l", "string"]);
const SEED_FIELDS = new Set(["seed", "noise_seed"]);

/** Промпт и seed из чанков ComfyUI. null — в файле нет графа. */
export function comfyRunContext(chunks: PngTextChunks): ComfyRunContext | null {
  const raw = chunks.prompt;
  if (!raw) return null;
  let graph: unknown;
  try {
    graph = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!graph || typeof graph !== "object") return null;
  const texts: ComfyRunContext["texts"] = [];
  const seeds: ComfyRunContext["seeds"] = [];
  const nodes = Object.entries(graph as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  for (const [node, value] of nodes) {
    if (!value || typeof value !== "object") continue;
    const { class_type: classType, inputs } = value as { class_type?: unknown; inputs?: unknown };
    if (!inputs || typeof inputs !== "object") continue;
    const type = typeof classType === "string" ? classType : "";
    for (const [field, input] of Object.entries(inputs as Record<string, unknown>)) {
      if (typeof input === "string" && TEXT_FIELDS.has(field) && input.trim()) {
        texts.push({ node, classType: type, field, text: input });
      }
      if (typeof input === "number" && SEED_FIELDS.has(field)) {
        seeds.push({ node, classType: type, field, value: input });
      }
    }
  }
  return { texts, seeds, hasWorkflow: Boolean(chunks.workflow) };
}
