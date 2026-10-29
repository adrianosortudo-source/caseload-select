import "server-only";
import { cookies, headers } from "next/headers";
import { CRM_AGENT_COOKIE, isCrmAgentRead } from "./crm-agent-policy";
import { verifyCrmAgentCookie } from "./crm-agent-registry";

export async function getCrmAgentReadSession(request?: Pick<Request, "url" | "method" | "headers">) {
  try {
    const h = request?.headers ?? await headers();
    const path = request ? new URL(request.url).pathname : h.get("x-caseload-request-path") ?? "";
    const method = request?.method ?? h.get("x-caseload-request-method") ?? "";
    const origin = request ? new URL(request.url).origin : h.get("x-caseload-request-origin") ?? "";
    if (!isCrmAgentRead(path, method)) return null;
    const raw = request
      ? h.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(`${CRM_AGENT_COOKIE}=`))?.slice(CRM_AGENT_COOKIE.length + 1)
      : (await cookies()).get(CRM_AGENT_COOKIE)?.value;
    return raw ? await verifyCrmAgentCookie(raw, origin) : null;
  } catch { return null; }
}
