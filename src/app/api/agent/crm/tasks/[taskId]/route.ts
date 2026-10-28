import { NextRequest, NextResponse } from "next/server";
import { CRM_TASK_HEADERS } from "@/lib/crm-task-policy";
import { crmTaskRpc, getCrmTaskSession } from "@/lib/crm-task-store";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const session = await getCrmTaskSession(request);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CRM_TASK_HEADERS });
  try {
    const plan = await crmTaskRpc(session.origin, "plan", { p_task_id: session.taskId, p_token_hash: session.tokenHash });
    return NextResponse.json(plan, { headers: CRM_TASK_HEADERS });
  } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CRM_TASK_HEADERS }); }
}
