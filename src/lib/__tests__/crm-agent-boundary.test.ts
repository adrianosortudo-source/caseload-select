import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CRM_AGENT_COOKIE, CRM_AGENT_ORIGIN, CRM_AGENT_EXCHANGE } from "../crm-agent-policy";

const fixture = vi.hoisted(() => ({
  raw: "c".repeat(64), cookies: new Map<string, string>(), active: true,
  session: { capability: "crm_console_read_qa", version: "synthetic-version", workflowSha: "a".repeat(40),
    runId: "123", runAttempt: "1", issuedAt: 1, expiresAt: 9999999999999, deadline: 9999999999999 },
  reads: vi.fn(), writes: vi.fn(), registry: vi.fn(), oidc: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (key: string) => fixture.cookies.has(key) ? { value: fixture.cookies.get(key) } : undefined }),
  headers: async () => new Headers({ host: "admin.caseloadselect.ca" }),
}));
vi.mock("../crm-agent-registry", async importOriginal => ({
  ...await importOriginal<typeof import("../crm-agent-registry")>(),
  verifyCrmAgentCookie: async (raw: string, origin: string) => fixture.active && raw === fixture.raw && origin === CRM_AGENT_ORIGIN ? fixture.session : null,
  crmAgentRegistry: (...args: unknown[]) => fixture.registry(...args),
}));
vi.mock("../crm-agent-github-oidc", () => ({ verifyCrmConsoleWorkflowToken: (...args: unknown[]) => fixture.oidc(...args) }));
vi.mock("../agency-crm", () => ({
  listProspectsPage: (...args: unknown[]) => fixture.reads(...args), listDeals: (...args: unknown[]) => fixture.reads(...args),
  listReminders: (...args: unknown[]) => fixture.reads(...args), isProspectStage: () => false, isUuid: () => true,
  createProspect: fixture.writes, createDeal: fixture.writes, createReminder: fixture.writes,
  updateProspect: fixture.writes, updateDeal: fixture.writes, updateReminder: fixture.writes,
}));
vi.mock("../agency-followup-service", () => ({ listAgencyFollowupConsole: fixture.reads }));
vi.mock("../agency-followup-opt-in", () => ({
  AgencyFollowupOptInError: class extends Error {}, listAgencyFollowupOptInHistory: fixture.reads,
  listAgencyFollowupOptInHistoryForAgent: fixture.reads, recordAgencyFollowupOptInEvent: fixture.writes,
}));
vi.mock("../prospect-operations", () => ({ getProspectContactReport: fixture.reads, getAgencyProspectConversation: fixture.reads, isProspectOperationsUuid: () => true }));

import * as prospects from "@/app/api/admin/agency-crm/prospects/route";
import * as deals from "@/app/api/admin/agency-crm/deals/route";
import * as reminders from "@/app/api/admin/agency-crm/reminders/route";
import * as followup from "@/app/api/admin/agency-crm/follow-up/route";
import * as consent from "@/app/api/admin/agency-crm/follow-up/opt-in/route";
import * as report from "@/app/api/admin/prospect-operations/report/route";
import * as conversation from "@/app/api/admin/prospect-operations/conversations/agency/[id]/route";
import * as prospect from "@/app/api/admin/agency-crm/prospects/[id]/route";
import * as deal from "@/app/api/admin/agency-crm/deals/[id]/route";
import * as reminder from "@/app/api/admin/agency-crm/reminders/[id]/route";
import * as exchange from "@/app/api/operator/crm-agent-session/route";
import { getOperatorSession, getPortalSession } from "../portal-auth";
import { middleware } from "@/middleware";

const id = "11111111-1111-4111-8111-111111111111";
function request(path: string, method = "GET", body?: object) {
  return new NextRequest(CRM_AGENT_ORIGIN + path, { method,
    headers: { cookie: `${CRM_AGENT_COOKIE}=${fixture.raw}; portal_session=synthetic-invalid-human`,
      host: "admin.caseloadselect.ca", Origin: CRM_AGENT_ORIGIN, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  vi.clearAllMocks(); fixture.cookies.clear(); fixture.cookies.set(CRM_AGENT_COOKIE, fixture.raw);
  fixture.cookies.set("portal_session", "synthetic-invalid-human"); fixture.active = true;
  fixture.reads.mockResolvedValue([]); fixture.registry.mockResolvedValue(fixture.session);
  fixture.oidc.mockResolvedValue({ sha: "a".repeat(40), runId: "123", runAttempt: "1", jtiSha256: "b".repeat(64) });
});
afterEach(() => vi.unstubAllEnvs());
describe("CRM agent route enforcement", () => {
  it("never resolves an agent as a human operator or portal principal", async () => {
    expect(await getPortalSession()).toBeNull(); expect(await getOperatorSession()).toBeNull();
  });
  for (const [path, route] of [["prospects", prospects], ["deals", deals], ["reminders", reminders], ["follow-up", followup]] as const) {
    it(`admits ${path} GET and rejects its POST before business writes`, async () => {
      expect((await route.GET(request(`/api/admin/agency-crm/${path}`))).status).toBe(200);
      expect((await route.POST(request(`/api/admin/agency-crm/${path}`, "POST", { action: "template_approve" })))?.status).toBe(401);
      expect(fixture.writes).not.toHaveBeenCalled();
    });
  }
  it("has an explicit consent-history read without an operator id", async () => {
    expect((await consent.GET(request(`/api/admin/agency-crm/follow-up/opt-in?prospectId=${id}`))).status).toBe(200);
    expect(fixture.reads).toHaveBeenCalledWith(expect.any(NextRequest), id);
    expect((await consent.POST(request("/api/admin/agency-crm/follow-up/opt-in", "POST", {}))).status).toBe(401);
    expect(fixture.writes).not.toHaveBeenCalled();
  });
  it("admits the summary and constrains conversation history to the agency source", async () => {
    expect((await report.GET(request("/api/admin/prospect-operations/report"))).status).toBe(200);
    expect((await conversation.GET(request(`/api/admin/prospect-operations/conversations/agency/${id}`), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect(fixture.reads).toHaveBeenCalledWith(id, { sourceOnly: true });
  });
  it("rejects all existing CRM record PATCH handlers", async () => {
    for (const [name, route] of [["prospects", prospect], ["deals", deal], ["reminders", reminder]] as const) {
      expect((await route.PATCH(request(`/api/admin/agency-crm/${name}/${id}`, "PATCH", { stage: "won" }), { params: Promise.resolve({ id }) })).status).toBe(401);
    }
    expect(fixture.writes).not.toHaveBeenCalled();
  });
  it("denies invalid or revoked reads before invoking data services", async () => {
    fixture.active = false;
    expect((await prospects.GET(request("/api/admin/agency-crm/prospects"))).status).toBe(401);
    expect(fixture.reads).not.toHaveBeenCalled();
  });
  it("middleware denies unrelated paths and every business mutation", async () => {
    for (const path of ["/admin/clients", "/api/admin/firms", "/api/admin/agency-crm/prospects/import", "/_next/static/app.js"]) {
      expect((await middleware(request(path, "POST", {}))).status).toBe(403);
    }
    expect((await middleware(request("/admin/clients"))).status).toBe(403);
    fixture.active = false;
    expect((await middleware(request("/admin/agency-crm"))).status).toBe(403);
  });
  it("middleware overwrites supplied context and forbids caching", async () => {
    const req = request("/admin/agency-crm"); req.headers.set("x-caseload-request-path", "/admin/clients");
    const response = await middleware(req);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-middleware-request-x-caseload-request-path")).toBe("/admin/agency-crm");
    expect(response.headers.get("x-middleware-request-x-caseload-request-origin")).toBe(CRM_AGENT_ORIGIN);
  });
  it("does not bypass the existing privacy recovery circuit", async () => {
    vi.stubEnv("PRIVACY_DELETION_REGISTRY_ENABLED", "true");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", ""); vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect((await middleware(request("/api/admin/agency-crm/follow-up"))).status).toBe(503);
  });
});
describe("CRM dedicated session exchange", () => {
  it("is unavailable by default without checking OIDC or writing storage", async () => {
    vi.stubEnv("CRM_AGENT_READ_ENABLED", "");
    expect((await exchange.POST(request(CRM_AGENT_EXCHANGE, "POST", { token: "synthetic" }))).status).toBe(404);
    expect(fixture.oidc).not.toHaveBeenCalled(); expect(fixture.registry).not.toHaveBeenCalled();
  });
  it("issues a host-only opaque hardened cookie and no token in JSON", async () => {
    vi.stubEnv("CRM_AGENT_READ_ENABLED", "true"); vi.stubEnv("VERCEL_ENV", "production");
    const response = await exchange.POST(request(CRM_AGENT_EXCHANGE, "POST", { token: "synthetic" }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(/__Host-crm_agent_session=[a-f0-9]{64};/);
    for (const flag of ["HttpOnly", "Secure", "SameSite=strict", "Path=/"]) expect(cookie).toContain(flag);
    expect(cookie).not.toContain("Domain=");
    expect(fixture.registry).toHaveBeenCalledWith(expect.objectContaining({ op: "issue", rotating: true }), expect.stringMatching(/^[a-f0-9]{64}$/), expect.stringMatching(/^[a-f0-9]{64}$/));
  });
  it("denies bad origin and rejected OIDC without storing credentials", async () => {
    vi.stubEnv("CRM_AGENT_READ_ENABLED", "true"); vi.stubEnv("VERCEL_ENV", "production");
    const req = request(CRM_AGENT_EXCHANGE, "POST", { token: "synthetic" }); req.headers.set("Origin", "https://evil.invalid");
    expect((await exchange.POST(req)).status).toBe(403); expect(fixture.oidc).not.toHaveBeenCalled();
    fixture.oidc.mockRejectedValueOnce(Error("sensitive provider error must not escape"));
    const response = await exchange.POST(request(CRM_AGENT_EXCHANGE, "POST", { token: "synthetic" }));
    expect(response.status).toBe(403); expect(await response.text()).not.toContain("sensitive");
    expect(fixture.registry).not.toHaveBeenCalled();
  });
});
