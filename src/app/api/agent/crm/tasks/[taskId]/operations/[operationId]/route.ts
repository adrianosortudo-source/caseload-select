import { NextRequest, NextResponse } from "next/server";
import { CRM_TASK_HEADERS } from "@/lib/crm-task-policy";
import { crmTaskRpc, getCrmTaskSession } from "@/lib/crm-task-store";
import { readCrmTaskJson } from "@/lib/crm-task-http";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const session = await getCrmTaskSession(request);
  if (!session?.operationId) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CRM_TASK_HEADERS });
  try {
    const operation = await readCrmTaskJson(request);
    const result = await crmTaskRpc(session.origin, "execute", { p_task_id: session.taskId, p_token_hash: session.tokenHash, p_operation_id: session.operationId, p_request: operation });
    return NextResponse.json(result, { headers: CRM_TASK_HEADERS });
  } catch { return NextResponse.json({ error: "Operation rejected" }, { status: 403, headers: CRM_TASK_HEADERS }); }
}
