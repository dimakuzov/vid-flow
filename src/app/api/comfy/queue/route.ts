import { NextResponse } from "next/server";
import { enqueueComfyJob, readComfyJob, startComfyQueue, type ComfyJob } from "@/lib/comfy/queue";

export const runtime = "nodejs";

export async function GET(request: Request) {
  startComfyQueue();
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Нужен id" }, { status: 400 });
  const job = readComfyJob(id);
  if (!job) return NextResponse.json({ error: "Задание не найдено" }, { status: 404 });
  return NextResponse.json(job);
}

export async function POST(request: Request) {
  startComfyQueue();
  try {
    const body = (await request.json()) as ComfyJob;
    const job = enqueueComfyJob(body);
    return NextResponse.json(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось поставить в очередь";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
