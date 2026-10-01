export interface ComfyImageRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

export interface ComfyHistory {
  outputs?: Record<string, { images?: ComfyImageRef[] }>;
  status?: { status_str?: string; completed?: boolean };
}

function comfyBase(): string {
  return (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  return text.trim() || `${res.status}`;
}

export async function uploadComfyImage(bytes: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(bytes)]), filename);
  form.append("overwrite", "true");
  const res = await fetch(`${comfyBase()}/upload/image`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload/image ${await readError(res)}`);
  const data = (await res.json()) as { name?: string };
  return data.name || filename;
}

export async function submitComfyPrompt(
  prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
): Promise<string> {
  const res = await fetch(`${comfyBase()}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const data = (await res.json()) as {
    prompt_id?: string;
    error?: unknown;
    node_errors?: Record<string, unknown>;
  };
  if (!res.ok) throw new Error(`prompt ${JSON.stringify(data.error || data)}`);
  const nodeErrors = data.node_errors || {};
  if (Object.keys(nodeErrors).length > 0) {
    throw new Error(`node_errors ${JSON.stringify(nodeErrors)}`);
  }
  if (!data.prompt_id) throw new Error("prompt_id пустой");
  return data.prompt_id;
}

export async function waitComfyHistory(promptId: string, timeoutMs = 15 * 60 * 1000): Promise<ComfyHistory> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${comfyBase()}/history/${promptId}`);
    if (res.ok) {
      const data = (await res.json()) as Record<string, ComfyHistory>;
      if (data[promptId]) return data[promptId];
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`история ${promptId} не пришла`);
}

export function listHistoryImages(history: ComfyHistory): ComfyImageRef[] {
  const images: ComfyImageRef[] = [];
  for (const output of Object.values(history.outputs || {})) {
    for (const image of output.images || []) images.push(image);
  }
  return images;
}

export async function downloadComfyImage(image: ComfyImageRef): Promise<Buffer> {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder || "",
    type: image.type || "output",
  });
  const res = await fetch(`${comfyBase()}/view?${query}`);
  if (!res.ok) throw new Error(`view ${image.filename} ${await readError(res)}`);
  return Buffer.from(await res.arrayBuffer());
}
