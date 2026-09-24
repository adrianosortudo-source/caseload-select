import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";
import ReconciledProspects, { type RecordsResponse } from "../../ReconciledProspects";

const h = vi.hoisted(() => {
  const state = { authorized: true, research: [] as unknown[], supplemental: [] as unknown[] };
  return {
    state,
    rpc: vi.fn(async (name: string) => {
      if (name === "list_gta_prospect_research_with_contacts_for_operator") return { data: state.research, error: null };
      if (name === "list_gta_prospect_supplemental_evidence_for_operator_v2") return { data: state.supplemental, error: null };
      if ([
        "list_gta_prospect_owner_contacts_for_operator",
        "list_gta_prospect_downtown_geography_for_operator",
        "list_gta_prospect_stable_identities_for_operator",
      ].includes(name)) return { data: [], error: null };
      throw new Error("Unexpected RPC in synthetic route test: " + name);
    }),
  };
});

vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: async () => h.state.authorized ? { role: "operator" } : null }));
vi.mock("@/lib/preview-qa-auth", () => ({ getPreviewQaReadSession: async () => null }));
// Keep every actual reader and the actual route; replace only their external transport.
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { rpc: h.rpc } }));
// Isolate unrelated static cohorts so every record in this response is synthetic.
vi.mock("../../reconciled-prospects", () => ({ RECONCILED_GTA_PROSPECTS: [] }));
vi.mock("@/lib/legacy-gta-prospect-source", () => ({ legacyGtaSourceRecords: () => [] }));
vi.mock("@/lib/qualified-gta-prospects", () => ({
  mergeQualifiedProspects: (records: readonly ReconciledGtaProspect[]) => ({
    records: [...records],
    report: { inputCount: 0, added: 0, updated: 0, ambiguous: 0, additions: [], updates: [], ambiguities: [] },
  }),
}));

import { GET } from "../route";

function research(id: string) {
  return {
    id, firm_name: "Synthetic " + id, city: "Toronto", office_cities: ["Toronto"],
    website_url: null, practice_areas: ["Family law"], observed_lawyer_count: 6,
    observed_lawyer_count_qualifier: "exact", observed_lawyer_count_display: null,
    roster_source_url: "https://example.test/team", roster_checked_at: "2026-09-24",
    reconciliation_status: "new_pending_identity", legacy_cluster_lawyer_count: null,
    legacy_crosswalk: null, reconciliation_note: null, advertising_evidence: "unknown",
    advertising_source_url: null, gbp_evidence: "unknown", gbp_source_url: null,
  };
}

function supplemental(id: string, criteria: unknown) {
  return {
    source_record_key: id, firm_id: null, canonical_domain: null,
    identity_match_state: null, identity_observed_on: null, identity_confidence: null, identity_source: null,
    website_intake_channels: ["phone", "contact_form"], website_opportunity_state: "not_established",
    website_observed_on: "2026-09-24", qualification_state: "needs_evidence",
    qualification_cohort: "synthetic-route-only", qualification_assessed_on: "2026-09-24",
    qualification_criteria: criteria,
  };
}

beforeEach(() => {
  h.state.authorized = true;
  h.state.research = [];
  h.state.supplemental = [];
  h.rpc.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is prohibited in this synthetic route test"); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("reconciled GET with actual rich supplemental reader", () => {
  it("returns lossless rich and legacy criteria by source key and renders the returned three-state GBP evidence", async () => {
    const cases = [
      { id: "synthetic-supported", value: true, label: "Supported evidence" },
      { id: "synthetic-needs", value: false, label: "Needs evidence" },
      { id: "synthetic-unassessed", value: null, label: "Not assessed" },
    ] as const;
    const rich = (gbpEvidence: boolean | null) => ({
      gbpEvidence, lawyerCount: 6, advertisingStatus: "pixels-detected",
      office: { city: "Toronto", sourceUrl: "https://example.test/contact", observedOn: "2026-09-24" },
      missingGates: ["independence", "recent-ad-verification"],
      directPublishedEmail: { email: "principal@example.test", sourceUrl: "https://example.test/team", deliverability: null },
      researchFailures: [{ url: "https://example.test/roster", status: 403 }],
    });
    const legacy = { lawyerCount: true, downtownGeometry: false, sharedIdentity: true };
    h.state.research = [...cases.map(item => research(item.id)), research("synthetic-legacy"), research("synthetic-no-supplement")];
    h.state.supplemental = [
      ...cases.map(item => supplemental(item.id, rich(item.value))),
      supplemental("synthetic-legacy", legacy),
      supplemental("synthetic-unmatched-source", { gbpEvidence: true }),
    ];

    const response = await GET();
    const body = await response.json() as { records: ReconciledGtaProspect[]; source: string; sourceCounts: unknown };
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.source).toBe("ledger");
    expect(body.sourceCounts).toEqual({ ledger: 5, fixture: 0 });
    expect(body.records).toHaveLength(5);
    expect(h.rpc).toHaveBeenCalledWith("list_gta_prospect_supplemental_evidence_for_operator_v2");
    expect(h.rpc.mock.calls.filter(([name]) => name === "list_gta_prospect_supplemental_evidence_for_operator_v2")).toHaveLength(1);

    for (const item of cases) {
      const record = body.records.find(candidate => candidate.id === item.id)!;
      expect(record.supplementalEvidence).toEqual({
        identity: null,
        websiteIntake: { channels: ["phone", "contact_form"], opportunityState: "not_established", observedOn: "2026-09-24" },
        qualification: { state: "needs_evidence", cohort: "synthetic-route-only", assessedOn: "2026-09-24", criteria: rich(item.value) },
      });
      expect(record.firmId).toBeNull();
      const html = renderToStaticMarkup(createElement<{ initialData?: RecordsResponse }>(ReconciledProspects, {
        initialData: { records: [record], source: "ledger" },
      }));
      expect(html).toContain("GBP: " + item.label);
      for (const other of cases.filter(candidate => candidate.label !== item.label)) expect(html).not.toContain("GBP: " + other.label);
    }
    expect(body.records.find(record => record.id === "synthetic-legacy")?.supplementalEvidence?.qualification?.criteria).toEqual(legacy);
    expect(body.records.find(record => record.id === "synthetic-no-supplement")?.supplementalEvidence).toBeNull();
    expect(body.records.some(record => record.id === "synthetic-unmatched-source")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["stable_identity_registry", "stable registry"],
    ["supplemental_observation", "supplemental observation"],
  ] as const)("preserves and displays v2 identity provenance: %s", async (source, label) => {
    h.state.research = [research("synthetic-provenance")];
    h.state.supplemental = [{
      ...supplemental("synthetic-provenance", { gbpEvidence: null }),
      firm_id: "FIRM-00000000000000000000000000", canonical_domain: "example.test",
      identity_match_state: "confirmed", identity_observed_on: "2026-09-24",
      identity_confidence: "high", identity_source: source,
    }];
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json() as { records: ReconciledGtaProspect[] };
    expect(body.records).toHaveLength(1);
    const record = body.records[0];
    expect(record.supplementalEvidence?.identity).toEqual({ matchState: "confirmed", observedOn: "2026-09-24", confidence: "high", source });
    // Supplemental provenance does not bypass the independent shared-registry reader.
    expect(record.firmId).toBeNull();
    const html = renderToStaticMarkup(createElement<{ initialData?: RecordsResponse }>(ReconciledProspects, { initialData: { records: [record], source: "ledger" } }));
    expect(html).toContain("Identity evidence: " + label);
    expect(html).toContain("GBP: Not assessed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps authorization ahead of every actual reader", async () => {
    h.state.authorized = false;
    const response = await GET();
    expect(response.status).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["non-JSON", "depth", "bytes"] as const)("fails the actual route safely for invalid supplemental %s", async kind => {
    let criteria: unknown = { nested: new Date("2026-09-24") };
    if (kind === "depth") {
      criteria = "too deep";
      for (let index = 0; index < 13; index++) criteria = { nested: criteria };
    }
    if (kind === "bytes") criteria = { note: "x".repeat(262144) };
    h.state.research = [research("synthetic-invalid")];
    h.state.supplemental = [supplemental("synthetic-invalid", criteria)];
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "GTA prospect research records could not be loaded." });
    expect(errorLog).toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith("list_gta_prospect_supplemental_evidence_for_operator_v2");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("all returned research states and structured intake through actual GET", () => {
  it.each(["selected", "held", "rejected", "incomplete"] as const)("retains source evidence, dates and original %s status in the route and profile view", async originalStatus => {
    const id = "synthetic-status-" + originalStatus;
    const channels = ["phone", { kind: "web-form", sourceUrl: "https://example.test/" + originalStatus, visibleFields: ["Name", "Email", "Phone", "Service", "Message", "Consent"] }, { kind: "program-specific-free-assessment", sourceUrl: "https://example.test/assessment" }];
    const criteria = { gbpEvidence: null, originalStatus, missingGates: originalStatus === "selected" ? [] : ["roster"], office: { sourceUrl: "https://example.test/office", observedOn: "2026-09-23" } };
    h.state.research = [research(id)];
    h.state.supplemental = [{ ...supplemental(id, criteria), website_intake_channels: channels, qualification_state: originalStatus === "selected" ? "qualified" : originalStatus === "rejected" ? "disqualified" : "needs_evidence" }];
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json() as { records: ReconciledGtaProspect[] };
    expect(body.records).toHaveLength(1);
    const record = body.records[0];
    expect(record.firmId).toBeNull();
    expect(record.supplementalEvidence?.websiteIntake).toEqual({ channels, opportunityState: "not_established", observedOn: "2026-09-24" });
    expect(record.supplementalEvidence?.qualification?.criteria).toEqual(criteria);
    const html = renderToStaticMarkup(createElement<{ initialData?: RecordsResponse }>(ReconciledProspects, { initialData: { records: [record], source: "ledger" } }));
    expect(html).toContain("Research profile");
    expect(html).toContain("Observed 2026-09-24");
    expect(html).toContain('href="https://example.test/' + originalStatus + '"');
    expect(html).toContain("Consent");
    expect(html).not.toContain("[object Object]");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a visible held warning and raw evidence for an unsupported channel shape", async () => {
    h.state.research = [research("synthetic-channel-warning")];
    const raw = [{ kind: "form", sourceUrl: "javascript:alert(1)", unknown: "retained" }];
    h.state.supplemental = [{ ...supplemental("synthetic-channel-warning", { originalStatus: "held" }), website_intake_channels: raw }];
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json() as { records: ReconciledGtaProspect[] };
    expect(body.records[0].supplementalEvidence?.websiteIntake?.readWarning?.rawChannels).toEqual(raw);
    const html = renderToStaticMarkup(createElement<{ initialData?: RecordsResponse }>(ReconciledProspects, { initialData: { records: body.records, source: "ledger" } }));
    expect(html).toContain("Intake evidence held for review");
    expect(html).not.toContain('href="javascript:');
  });
});
