import { NextResponse } from "next/server";
import { listAgentProviders } from "@/lib/agent/providers";

export const runtime = "nodejs";

/** Провайдеры агента и их доступность на этой машине (docs/contracts/agent-request.md, «API»). */
export async function GET() {
  return NextResponse.json(await listAgentProviders());
}
