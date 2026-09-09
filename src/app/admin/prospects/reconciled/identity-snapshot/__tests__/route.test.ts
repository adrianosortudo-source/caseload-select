import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ session: null as object | null, records: [] as unknown[] }));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: () => Promise.resolve(h.session) }));
vi.mock("@/lib/gta-prospect-research-reader", () => ({ listGtaProspectResearchForOperator: () => Promise.resolve(h.records) }));

import { GET } from "../route";

beforeEach(() => { h.session = null; h.records = []; });

describe("operator identity snapshot route", () => {
  it("fails closed on 401 before reading a snapshot", async () => {
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("does not fall back to fixtures when the live projection is empty", async () => {
    h.session = { role: "operator" };
    const response = await GET();
    expect(response.status).toBe(503);
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
    expect(body.records).toEqual([{ record_id: "ledger-1", normalized_firm_name: "example law", canonical_domain: "example.test" }]);
    expect(JSON.stringify(body)).not.toContain("owner@example.test");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
