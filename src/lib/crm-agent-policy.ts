/** Dedicated CRM capability. Keep this dependency-free for the edge boundary. */
export const CRM_AGENT_COOKIE = "__Host-crm_agent_session";
export const CRM_AGENT_CAPABILITY = "crm_console_read_qa";
export const CRM_AGENT_ORIGIN = "https://admin.caseloadselect.ca";
export const CRM_AGENT_EXCHANGE = "/api/operator/crm-agent-session";
const reads = new Set([
  "/admin/agency-crm", "/admin/agency-crm/follow-up",
  "/api/admin/agency-crm/prospects", "/api/admin/agency-crm/deals",
  "/api/admin/agency-crm/reminders", "/api/admin/agency-crm/follow-up",
  "/api/admin/agency-crm/follow-up/opt-in", "/api/admin/prospect-operations/report",
]);
const conversation = /^\/api\/admin\/prospect-operations\/conversations\/agency\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isCrmAgentRead(path: string, method: string): boolean {
  return (method === "GET" || method === "HEAD") &&
    (reads.has(path) || conversation.test(path) || path.startsWith("/_next/static/") || path === "/favicon.ico");
}
export function isCrmAgentExchange(path: string, method: string): boolean {
  return path === CRM_AGENT_EXCHANGE && method === "POST";
}
