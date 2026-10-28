import { CRM_AGENT_CAPABILITY, CRM_AGENT_ORIGIN } from "./crm-agent-policy";

export const CRM_AGENT_PREFIX = "agent:{crm-console-read-qa}:v1:";
export const CRM_AGENT_TTL = 15 * 60_000;
export const CRM_AGENT_ROTATE_AFTER = 10 * 60_000;
export const CRM_AGENT_JOB_CAP = 60 * 60_000;
export interface CrmAgentSession {
  capability: typeof CRM_AGENT_CAPABILITY;
  version: string; workflowSha: string; runId: string; runAttempt: string;
  issuedAt: number; expiresAt: number; deadline: number;
}
export interface CrmAgentIdentity {
  sha: string; runId: string; runAttempt: string; jtiSha256: string;
}

// One atomic operation checks the live grant, consumes each OIDC jti once,
// preserves the job deadline, and invalidates the old hash during rotation.
// There are no business-data writes and no raw credentials in Redis.
export const CRM_AGENT_REGISTRY_LUA = `
local function decode(raw)
  if not raw then return nil end
  local ok, value = pcall(cjson.decode, raw)
  if not ok or type(value) ~= 'table' then return nil end
  return value
end
local input = decode(ARGV[1])
local grant = decode(redis.call('GET', KEYS[1]))
local now = tonumber(ARGV[2])
if not input or not grant or grant.enabled ~= true or grant.capability ~= 'crm_console_read_qa'
  or grant.origin ~= 'https://admin.caseloadselect.ca' or type(grant.version) ~= 'string'
  or string.len(grant.version) < 16 or type(grant.expiresAt) ~= 'number' or grant.expiresAt <= now
  or type(grant.workflowSha) ~= 'string' or string.len(grant.workflowSha) ~= 40 then return '' end
local function active(s)
  return s and s.capability == grant.capability and s.version == grant.version
    and s.workflowSha == grant.workflowSha and type(s.expiresAt) == 'number' and s.expiresAt > now
    and type(s.deadline) == 'number' and s.deadline > now
end
local function audit(event, s)
  redis.call('XADD', KEYS[5], 'MAXLEN', '~', 10000, '*',
    'event', event, 'capability', grant.capability, 'runId', s.runId, 'runAttempt', s.runAttempt)
end
if input.op == 'verify' then
  local s = decode(redis.call('GET', KEYS[2]))
  if not active(s) then return '' end
  audit('read', s)
  return cjson.encode(s)
end
if input.op ~= 'issue' or input.sha ~= grant.workflowSha then return '' end
if redis.call('EXISTS', KEYS[3]) == 1 then return '' end
local deadline = tonumber(redis.call('GET', KEYS[4]))
local previous = nil
if input.rotating then
  previous = decode(redis.call('GET', KEYS[6]))
  if not active(previous) or previous.runId ~= input.runId or previous.runAttempt ~= input.runAttempt
    or now - previous.issuedAt < 600000 then return '' end
  if not deadline or deadline ~= previous.deadline then return '' end
elseif deadline then
  -- No second bootstrap for the same run/attempt, including after expiry/revocation.
  return ''
end
if not deadline then deadline = now + 3600000 end
if deadline <= now then return '' end
local s = { capability = grant.capability, version = grant.version, workflowSha = input.sha,
  runId = input.runId, runAttempt = input.runAttempt, issuedAt = now,
  expiresAt = math.min(now + 900000, deadline, grant.expiresAt), deadline = deadline }
if s.expiresAt <= now then return '' end
audit(input.rotating and 'rotated' or 'issued', s)
redis.call('SET', KEYS[4], tostring(deadline), 'PX', 604800000)
redis.call('SET', KEYS[3], 'used', 'PX', 660000)
redis.call('SET', KEYS[2], cjson.encode(s), 'PX', math.floor(s.expiresAt - now))
if input.rotating then redis.call('DEL', KEYS[6]) end
return cjson.encode(s)
`;

export function crmAgentEnabled(): boolean {
  return process.env.CRM_AGENT_READ_ENABLED === "true" && process.env.VERCEL_ENV === "production";
}
export async function crmAgentHash(raw: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
export function isCrmAgentToken(raw: string): boolean { return /^[a-f0-9]{64}$/.test(raw); }
export async function crmAgentRegistry(
  input: { op: "verify" } | ({ op: "issue"; rotating: boolean } & CrmAgentIdentity),
  hash: string, previousHash = "none",
  options: { fetcher?: typeof fetch; now?: number } = {},
): Promise<CrmAgentSession | null> {
  if (!crmAgentEnabled() || !isCrmAgentToken(hash)) return null;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    if (new URL(url).protocol !== "https:") return null;
    const identity = input.op === "issue" ? input : null;
    const keys = ["grant", `session:${hash}`, `jti:${identity?.jtiSha256 ?? "none"}`,
      `run:${identity?.runId ?? "none"}:${identity?.runAttempt ?? "none"}`, "audit", `session:${previousHash}`]
      .map(key => CRM_AGENT_PREFIX + key);
    const response = await (options.fetcher ?? fetch)(url, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["EVAL", CRM_AGENT_REGISTRY_LUA, keys.length, ...keys, JSON.stringify(input), options.now ?? Date.now()]),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const result = await response.json() as { result?: unknown; error?: unknown };
    if (result.error || typeof result.result !== "string" || !result.result) return null;
    const session = JSON.parse(result.result) as CrmAgentSession;
    return session.capability === CRM_AGENT_CAPABILITY ? session : null;
  } catch { return null; }
}

export async function verifyCrmAgentCookie(raw: string, origin: string): Promise<CrmAgentSession | null> {
  if (origin !== CRM_AGENT_ORIGIN || !isCrmAgentToken(raw)) return null;
  return crmAgentRegistry({ op: "verify" }, await crmAgentHash(raw));
}
