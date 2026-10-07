import { NextResponse } from "next/server";
import { listAgentRuns } from "@/lib/series/agent-dispatch";

export const runtime = "nodejs";

/** Агенты доски по всем эпизодам: `{ running, queued }` (docs/contracts/agent-request.md, «API»). */
export async function GET() {
  return NextResponse.json(listAgentRuns());
}
