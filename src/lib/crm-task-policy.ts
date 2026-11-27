import { CRM_AGENT_COOKIE } from "./crm-agent-policy";
import { PREVIEW_QA_COOKIE_NAME } from "./preview-qa-policy";
/** Edge-safe policy. A task principal never becomes a human operator. */
export const CRM_TASK_COOKIE = "__Host-crm_task_session";
export const CRM_SYNTHETIC_COOKIE = "crm_synthetic_task_session";
export const CRM_TASK_EXCHANGE = "/api/operator/crm-task-session";
export const CRM_TASK_ORIGIN = "https://admin.caseloadselect.ca";
export const CRM_TASK_PROJECT = "caseload-select";
export const CRM_TASK_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type CrmTaskMode = "production" | "synthetic";
const loopback = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);

export function crmTaskConfig(origin: string, env: Record<string, string | undefined> = process.env) {
  try {
    const db = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? ""), target = new URL(origin);
    if (db.username || db.password || db.search || db.hash || !["", "/"].includes(db.pathname) || target.origin !== origin) return null;
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
    if (env.CRM_AGENT_TASK_WRITES_ENABLED === "true" && env.VERCEL_ENV === "production" &&
        origin === CRM_TASK_ORIGIN && db.origin === "https://ssxryjxifwiivghglqer.supabase.co") {
      return { mode: "production" as CrmTaskMode, cookie: CRM_TASK_COOKIE, dbOrigin: db.origin };
    }
    if (env.CRM_AGENT_SYNTHETIC_WRITE_ENABLED === "true" && env.VERCEL_ENV !== "production" &&
        ["test", "development"].includes(env.NODE_ENV ?? "") && loopback(db.hostname) && loopback(target.hostname) &&
        ["http:", "https:"].includes(db.protocol) && ["http:", "https:"].includes(target.protocol)) {
      return { mode: "synthetic" as CrmTaskMode, cookie: CRM_SYNTHETIC_COOKIE, dbOrigin: db.origin };
    }
  } catch { /* Disabled, including malformed environment. */ }
  return null;
}

export function crmTaskRoute(path: string, method: string): { taskId: string; operationId?: string } | null {
  const match = /^\/api\/agent\/crm\/tasks\/([0-9a-f-]+)(?:\/operations\/([0-9a-f-]+))?$/.exec(path);
  if (!match || !CRM_TASK_UUID.test(match[1]) || (match[2] && !CRM_TASK_UUID.test(match[2]))) return null;
  if (match[2] ? method !== "POST" : method !== "GET") return null;
  return { taskId: match[1], ...(match[2] ? { operationId: match[2] } : {}) };
}

export function hasCrmTaskCookie(header: string | null): boolean {
  return (header ?? "").split(";").some(part => [CRM_TASK_COOKIE, CRM_SYNTHETIC_COOKIE].includes(part.trim().split("=")[0]));
}

export function crmTaskRawCookie(header: string | null, name: string): string | null {
  const matches = (header ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith(`${name}=`));
  return matches.length === 1 && /^[a-f0-9]{64}$/.test(matches[0].slice(name.length + 1)) ? matches[0].slice(name.length + 1) : null;
}

export function crmTaskMixedPrincipal(header: string | null, name: string): boolean {
  const known = [CRM_TASK_COOKIE, CRM_SYNTHETIC_COOKIE, CRM_AGENT_COOKIE, PREVIEW_QA_COOKIE_NAME, "portal_session"];
  const principals = (header ?? "").split(";").map(v => v.trim().split("=")[0]).filter(v => known.includes(v));
  return principals.length > 1 || (principals.length === 1 && principals[0] !== name);
}

export const CRM_TASK_HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };
