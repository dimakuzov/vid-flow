export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startComfyQueue } = await import("./lib/comfy/queue");
  startComfyQueue();
}
