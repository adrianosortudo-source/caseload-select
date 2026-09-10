import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ session: null as object | null, records: [] as unknown[], failure: null as Error | null, read: vi.fn() }));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: () => Promise.resolve(h.session) }));
vi.mock("@/lib/gta-prospect-research-reader", () => ({ listGtaProspectResearchForOperator: h.read }));

import { GET } from "../route";

beforeEach(() => {
  h.session = null;
  h.records = [];
  h.failure = null;
  h.read.mockReset().mockImplementation(async () => {
    if (h.failure) throw h.failure;
    return h.records;
  });
});

describe("operator identity snapshot route", () => {
  it("fails closed on 401 before reading a snapshot", async () => {
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(h.read).not.toHaveBeenCalled();
  });

  it("sanitizes reader failures and disables caching", async () => {
    h.session = { role: "operator" };
    h.failure = new Error("owner-secret@example.test CRM_SECRET");
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual({ error: "Live prospect identity snapshot is unavailable." });
    expect(JSON.stringify(body)).not.toMatch(/owner-secret|CRM_SECRET/i);
  });

  it("does not fall back to fixtures when the live projection is empty", async () => {
    h.session = { role: "operator" };
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns only the sanitized identity contract", async () => {
    h.session = { role: "operator" };
    h.records = [{
      id: "ledger-1", firmName: "Example Law LLP", canonicalDomain: "example.test", websiteUrl: "https://example.test",
      rosterSourceUrl: "https://example.test/team", publicContacts: [{ name: "Owner", email: "owner@example.test" }],
    }];
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.records).toEqual([{ source_system: "gta_research", source_record_key: "ledger-1", normalized_firm_name: "example law", canonical_domain: "example.test" }]);
    expect(JSON.stringify(body)).not.toContain("owner@example.test");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
