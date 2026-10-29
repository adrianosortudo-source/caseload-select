import { describe, expect, it, vi, afterEach } from "vitest";
import { isCrmAgentRead, isCrmAgentExchange, CRM_AGENT_ORIGIN } from "../crm-agent-policy";
import { crmAgentRegistry, crmAgentHash, verifyCrmAgentCookie } from "../crm-agent-registry";

afterEach(() => vi.unstubAllEnvs());
describe("CRM dedicated capability boundary", () => {
  it.each([
    "/admin/agency-crm", "/admin/agency-crm/follow-up", "/api/admin/agency-crm/prospects",
    "/api/admin/agency-crm/deals", "/api/admin/agency-crm/reminders",
    "/api/admin/agency-crm/follow-up", "/api/admin/agency-crm/follow-up/opt-in",
    "/api/admin/prospect-operations/report",
    "/api/admin/prospect-operations/conversations/agency/11111111-1111-4111-8111-111111111111",
    "/_next/static/chunks/app.js", "/favicon.ico",
  ])("allows only safe reads for %s", path => {
    expect(isCrmAgentRead(path, "GET")).toBe(true);
    expect(isCrmAgentRead(path, "HEAD")).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) expect(isCrmAgentRead(path, method)).toBe(false);
  });
  it.each([
    "/admin", "/admin/clients", "/admin/prospects", "/api/admin/firms", "/api/admin/secrets",
    "/portal/example", "/api/admin/agency-crm/prospects/import", "/api/admin/agency-crm/follow-up/send",
    "/api/admin/prospect-operations/conversations/source", "/api/admin/prospect-operations/conversations/agency/nope",
    "/api/admin/agency-crm/follow-up/", "/api/admin/agency-crm/follow-up/opt-in/extra", "/_next/image", "/malicious.png",
  ])("rejects unrelated routes %s", path => expect(isCrmAgentRead(path, "GET")).toBe(false));
  it("has exactly one POST exception", () => {
    expect(isCrmAgentExchange("/api/operator/crm-agent-session", "POST")).toBe(true);
    expect(isCrmAgentExchange("/api/operator/crm-agent-session", "GET")).toBe(false);
    expect(isCrmAgentExchange("/api/operator/crm-agent-session/", "POST")).toBe(false);
  });
  it("is disabled by default and in preview even with the flag", async () => {
    const fetcher = vi.fn();
    vi.stubEnv("CRM_AGENT_READ_ENABLED", ""); vi.stubEnv("VERCEL_ENV", "production");
    expect(await crmAgentRegistry({ op: "verify" }, "a".repeat(64), "none", { fetcher })).toBeNull();
    vi.stubEnv("CRM_AGENT_READ_ENABLED", "true"); vi.stubEnv("VERCEL_ENV", "preview");
    expect(await crmAgentRegistry({ op: "verify" }, "a".repeat(64), "none", { fetcher })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses only the dedicated Redis integration and never falls back to app-wide rate-limit Redis", async () => {
    vi.stubEnv("CRM_AGENT_READ_ENABLED", "true"); vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_KV_REST_API_URL", "https://agent-redis.synthetic.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_KV_REST_API_TOKEN", "agent-only-synthetic-token");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://general-redis.synthetic.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "general-synthetic-token");
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://agent-redis.synthetic.invalid");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer agent-only-synthetic-token");
      return new Response(JSON.stringify({ result: JSON.stringify({ capability: "crm_console_read_qa" }) }));
    });
    expect(await crmAgentRegistry({ op: "verify" }, "a".repeat(64), "none", { fetcher })).not.toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("fails closed when dedicated Redis settings are missing even if app-wide Redis is configured", async () => {
    vi.stubEnv("CRM_AGENT_READ_ENABLED", "true"); vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_KV_REST_API_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_KV_REST_API_TOKEN", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://general-redis.synthetic.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "general-synthetic-token");
    const fetcher = vi.fn();
    expect(await crmAgentRegistry({ op: "verify" }, "a".repeat(64), "none", { fetcher })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("hashes credentials and rejects aliases, app host, and malformed cookies", async () => {
    expect(await crmAgentHash("synthetic-secret")).toMatch(/^[a-f0-9]{64}$/);
    expect(await verifyCrmAgentCookie("a".repeat(64), "https://app.caseloadselect.ca")).toBeNull();
    expect(await verifyCrmAgentCookie("invalid", CRM_AGENT_ORIGIN)).toBeNull();
  });
  it.each([new Response("", { status: 503 }), new Response('{"error":"down"}'), new Response('{"result":""}'), new Response('bad-json')])("fails closed on registry failure", async response => {
    vi.stubEnv("CRM_AGENT_READ_ENABLED", "true"); vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_KV_REST_API_URL", "https://synthetic.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_KV_REST_API_TOKEN", "synthetic-only");
    expect(await crmAgentRegistry({ op: "verify" }, "a".repeat(64), "none", { fetcher: async () => response })).toBeNull();
  });
});
