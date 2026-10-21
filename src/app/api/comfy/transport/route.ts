import { NextResponse } from "next/server";
import { comfyBusy } from "@/lib/comfy/queue";
import { transportName, writeTransportSetting } from "@/lib/comfy/transport";

export const runtime = "nodejs";

function state() {
  return { transport: transportName(), locked: comfyBusy() };
}

export async function GET() {
  return NextResponse.json(state());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { transport?: unknown };
  if (body.transport !== "legacy" && body.transport !== "sdk") {
    return NextResponse.json({ error: "transport: legacy или sdk" }, { status: 400 });
  }
  // Задание, ушедшее одним транспортом, другой не найдёт по id: пока идёт генерация, не меняем.
  if (comfyBusy()) return NextResponse.json({ error: "Идёт генерация", ...state() }, { status: 409 });
  writeTransportSetting(body.transport);
  return NextResponse.json(state());
}
