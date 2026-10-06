export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { prepareDataRoot } = await import("./lib/series/paths");
  // Перенос старой раскладки и общие папки — один раз при старте, не при каждом чтении.
  prepareDataRoot();
  const { startComfyQueue } = await import("./lib/comfy/queue");
  const { startAgentDispatch } = await import("./lib/series/agent-dispatch");
  startComfyQueue();
  startAgentDispatch();
}
