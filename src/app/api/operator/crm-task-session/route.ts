import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { crmTaskConfig, CRM_TASK_HEADERS, CRM_TASK_UUID, crmTaskRawCookie, crmTaskMixedPrincipal } from "@/lib/crm-task-policy";
import { crmTaskHash, crmTaskRpc } from "@/lib/crm-task-store";
import { readCrmTaskJson } from "@/lib/crm-task-http";
import { verifyCrmTaskWorkflowToken } from "@/lib/crm-task-github-oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const origin = new URL(request.url).origin, config = crmTaskConfig(origin);
  // Local synthetic fixtures are issued by the isolated test harness, never by an unauthenticated HTTP bootstrap.
  if (!config || config.mode !== "production") return NextResponse.json({ error: "Unavailable" }, { status: 404, headers: CRM_TASK_HEADERS });
  try {
    if (crmTaskMixedPrincipal(request.headers.get("cookie"), config.cookie)) throw Error();
    const body = await readCrmTaskJson(request, 20_000);
    if (Object.keys(body).sort().join(",") !== "taskId,token" || typeof body.taskId !== "string" || !CRM_TASK_UUID.test(body.taskId) || typeof body.token !== "string") throw Error();
    const identity = await verifyCrmTaskWorkflowToken(body.token);
    const previous = crmTaskRawCookie(request.headers.get("cookie"), config.cookie);
    if (request.cookies.has(config.cookie) && !previous) throw Error();
    const raw = randomBytes(32).toString("hex");
    const result = await crmTaskRpc(origin, "issue", { p_task_id: body.taskId, p_token_hash: await crmTaskHash(raw), p_previous_hash: previous ? await crmTaskHash(previous) : null,
      p_workflow_sha: identity.sha, p_run_id: identity.runId, p_run_attempt: identity.runAttempt, p_jti_hash: identity.jtiSha256 }) as { expiresAt?: number } | null;
    if (!result || typeof result.expiresAt !== "number" || result.expiresAt <= Date.now()) throw Error();
    const response = NextResponse.json({ ok: true }, { headers: CRM_TASK_HEADERS });
    response.cookies.set(config.cookie, raw, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: Math.floor((result.expiresAt - Date.now()) / 1000) });
    return response;
  } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CRM_TASK_HEADERS }); }
}
