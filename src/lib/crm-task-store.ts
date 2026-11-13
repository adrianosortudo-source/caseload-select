import { crmTaskConfig, crmTaskMixedPrincipal, crmTaskRawCookie, crmTaskRoute } from "./crm-task-policy";

/** Fixed RPCs only; the database is the transactional authorization boundary. */
export async function crmTaskRpc(origin: string, op: "issue" | "verify" | "plan" | "execute", args: Record<string, unknown>) {
  const config = crmTaskConfig(origin);
  if (!config) throw Error("crm_task_unavailable");
  const response = await fetch(`${config.dbOrigin}/rest/v1/rpc/crm_agent_task_${op}`, {
    method: "POST", headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...args, p_origin: origin, p_mode: config.mode }),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw Error("crm_task_rejected");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 2_500_000) throw Error("crm_task_response_invalid");
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export async function crmTaskHash(raw: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))), b => b.toString(16).padStart(2, "0")).join("");
}

export async function getCrmTaskSession(request: Pick<Request, "url" | "method" | "headers">) {
  try {
    const url = new URL(request.url), config = crmTaskConfig(url.origin), route = crmTaskRoute(url.pathname, request.method);
    if (!config || !route || crmTaskMixedPrincipal(request.headers.get("cookie"), config.cookie)) return null;
    const raw = crmTaskRawCookie(request.headers.get("cookie"), config.cookie);
    if (!raw) return null;
    const tokenHash = await crmTaskHash(raw);
    const result = await crmTaskRpc(url.origin, "verify", { p_task_id: route.taskId, p_token_hash: tokenHash });
    if (!result || typeof result !== "object" || !Object.hasOwn(result, "expiresAt")) return null;
    return { ...route, tokenHash, origin: url.origin };
  } catch { return null; }
}
