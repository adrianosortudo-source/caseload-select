import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECONCILED_GTA_PROSPECTS } from "../../reconciled-prospects";

const h = vi.hoisted(() => {
  class Unavailable extends Error {}
  const state = {
    session: null as { role: "operator" } | null,
    records: [] as unknown[],
    failure: null as Error | null,
    ownerContacts: [] as unknown[],
    ownerFailure: null as Error | null,
    stableIdentities: [] as unknown[],
    supplemental: [] as unknown[],
    geographyFailure: null as Error | null,
  };
  return {
    state,
    read: vi.fn(async () => {
      if (state.failure) throw state.failure;
      return state.records;
    }),
    ownerRead: vi.fn(async () => {
      if (state.ownerFailure) throw state.ownerFailure;
      return state.ownerContacts;
    }),
    stableRead: vi.fn(async () => state.stableIdentities),
    Unavailable,
    OwnerUnavailable: class OwnerUnavailable extends Error {},
  };
});

vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: () => Promise.resolve(h.state.session) }));
vi.mock("@/lib/gta-prospect-research-reader", () => ({
  GtaProspectLedgerUnavailableError: h.Unavailable,
  listGtaProspectResearchForOperator: h.read,
}));
vi.mock("@/lib/gta-prospect-owner-contact-reader", () => ({
  GtaProspectOwnerContactLedgerUnavailableError: h.OwnerUnavailable,
  listGtaProspectOwnerContactsForOperator: h.ownerRead,
}));
vi.mock("@/lib/gta-prospect-downtown-geography-reader", () => ({
  GtaProspectDowntownGeographyLedgerUnavailableError: class extends Error {},
  listGtaProspectDowntownGeographyForOperator: () => {
    if (h.state.geographyFailure) return Promise.reject(h.state.geographyFailure);
    return Promise.resolve([]);
  },
}));
vi.mock("@/lib/gta-prospect-supplemental-evidence-reader", () => ({
  GtaProspectSupplementalEvidenceLedgerUnavailableError: class extends Error {},
  listGtaProspectSupplementalEvidenceForOperator: () => Promise.resolve(h.state.supplemental),
}));
vi.mock("@/lib/gta-prospect-stable-identity-reader", () => ({
  GtaProspectStableIdentityRegistryUnavailableError: class extends Error {},
  listGtaProspectStableIdentitiesForOperator: h.stableRead,
}));

import { GET } from "../route";

beforeEach(() => {
  h.state.session = null;
  h.state.records = [];
  h.state.failure = null;
  h.state.ownerContacts = [];
  h.state.ownerFailure = null;
  h.state.stableIdentities = [];
  h.state.supplemental = [];
  h.state.geographyFailure = null;
  h.read.mockClear();
  h.ownerRead.mockClear();
  h.stableRead.mockClear();
});

describe("reviewed GTA prospects route", () => {
  it("keeps the operator gate ahead of every ledger read", async () => {
    const response = await GET();
    expect(response.status).toBe(401);
    expect(h.read).not.toHaveBeenCalled();
    expect(h.ownerRead).not.toHaveBeenCalled();
  });

  it("returns the source-controlled fixture when the projection migration is unavailable", async () => {
    h.state.session = { role: "operator" };
    h.state.failure = new h.Unavailable();
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      source: "fixture",
      sourceCounts: { ledger: 0, fixture: 20 },
      qualifiedImport: { inputCount: 20, added: 20, updated: 0, ambiguous: 0 },
      fallbackReason: "ledger_unavailable",
    });
  });

  it("uses the fixture-only fallback when the ledger has no records", async () => {
    h.state.session = { role: "operator" };
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.source).toBe("fixture");
    expect(body.sourceCounts).toEqual({ ledger: 0, fixture: 20 });
    expect(body.fallbackReason).toBe("ledger_empty");
    expect(body.records).toHaveLength(5_942);
    expect(body.qualifiedImport).toMatchObject({ inputCount: 20, added: 20, updated: 0, ambiguous: 0 });
    expect(body.records.filter((record: { qualifiedDossier?: unknown }) => record.qualifiedDossier)).toHaveLength(20);
  });

  it("shows nonempty ledger records alongside only the missing fixtures", async () => {
    h.state.session = { role: "operator" };
    const ledgerOverride = { ...RECONCILED_GTA_PROSPECTS[0], firmName: "Aastha Lawyers from ledger" };
    const ledgerAddition = { ...RECONCILED_GTA_PROSPECTS[0], id: "later-reviewed-firm", firmName: "Later reviewed firm" };
    h.state.records = [ledgerAddition, ledgerOverride];
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.source).toBe("hybrid");
    expect(body.sourceCounts).toEqual({ ledger: 2, fixture: 19 });
    expect(body.fallbackReason).toBeUndefined();
    expect(body.records).toHaveLength(5_943);
    expect(body.qualifiedImport).toMatchObject({ added: 20, updated: 0, ambiguous: 0 });
    expect(body.records.filter((record: { id: string }) => record.id === RECONCILED_GTA_PROSPECTS[0].id)).toHaveLength(1);
    expect(body.records.find((record: { id: string }) => record.id === RECONCILED_GTA_PROSPECTS[0].id).firmName).toBe("Aastha Lawyers from ledger");
    expect(body.records.map((record: { firmName: string }) => record.firmName)).toEqual(
      [...body.records.map((record: { firmName: string }) => record.firmName)].sort((left, right) => left.localeCompare(right, "en-CA", { sensitivity: "base" })),
    );
  });

  it("attaches only the operator owner-contact presentation by matching the stable source key", async () => {
    h.state.session = { role: "operator" };
    h.state.records = [RECONCILED_GTA_PROSPECTS[0]];
    h.state.ownerContacts = [{
      sourceRecordKey: RECONCILED_GTA_PROSPECTS[0].id,
      ownerName: "Example Founder",
      ownerRole: "founding_partner",
      ownershipConfidence: "confirmed_owner",
      ownershipSourceUrl: "https://example.test/about",
      ownershipObservedOn: "2026-09-08",
      emailAvailability: "direct_owner_email",
      emailAddress: "founder@example.test",
      emailSourceUrl: "https://example.test/contact",
      emailObservedOn: "2026-09-08",
      isPrimaryContact: true,
    }];

    const response = await GET();
    const body = await response.json();
    const record = body.records.find((candidate: { id: string }) => candidate.id === RECONCILED_GTA_PROSPECTS[0].id);
    expect(record.ownerContact).toEqual({
      ownerName: "Example Founder",
      ownerRole: "founding_partner",
      ownershipConfidence: "confirmed_owner",
      emailAvailability: "direct_owner_email",
      emailAddress: "founder@example.test",
    });
    expect(record.ownerContact).not.toHaveProperty("ownershipSourceUrl");
    expect(record.ownerContact).not.toHaveProperty("emailSourceUrl");
  });

  it("keeps records available when the owner-contact projection has not been migrated yet", async () => {
    h.state.session = { role: "operator" };
    h.state.ownerFailure = new h.OwnerUnavailable();
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.records).toHaveLength(5_942);
    expect(body.records.every((record: { ownerContact: unknown }) => record.ownerContact === null)).toBe(true);
  });

  it("keeps the primary registry available when optional geography evidence is malformed", async () => {
    h.state.session = { role: "operator" };
    h.state.records = [RECONCILED_GTA_PROSPECTS[0]];
    h.state.geographyFailure = new Error("Invalid GTA prospect Downtown geography projection: boundary_source_url is invalid");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.records).toHaveLength(5_942);
    expect(body.records.find((record: { id: string }) => record.id === RECONCILED_GTA_PROSPECTS[0].id).downtownGeography).toBeNull();
  });

  it("shows a 103-record ledger batch alongside the 20 disjoint fixtures", async () => {
    h.state.session = { role: "operator" };
    h.state.records = Array.from({ length: 103 }, (_, index) => ({
      ...RECONCILED_GTA_PROSPECTS[0],
      id: `imported-firm-${String(index + 1).padStart(3, "0")}`,
      firmName: `Imported firm ${String(index + 1).padStart(3, "0")}`,
    }));
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.source).toBe("hybrid");
    expect(body.sourceCounts).toEqual({ ledger: 103, fixture: 20 });
    expect(body.records).toHaveLength(6_045);
    expect(body.qualifiedImport).toMatchObject({ added: 20, updated: 0, ambiguous: 0 });
    expect(new Set(body.records.map((record: { id: string }) => record.id)).size).toBe(6_045);
  });

  it("uses only ledger rows after every fixture key is represented", async () => {
    h.state.session = { role: "operator" };
    h.state.records = [...RECONCILED_GTA_PROSPECTS].reverse();
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.source).toBe("ledger");
    expect(body.sourceCounts).toEqual({ ledger: 20, fixture: 0 });
    expect(body.records).toHaveLength(5_942);
    expect(body.qualifiedImport).toMatchObject({ added: 20, updated: 0, ambiguous: 0 });
  });

  it("enriches a ledger record by normalized canonical domain instead of duplicating it", async () => {
    h.state.session = { role: "operator" };
    h.state.records = [{
      ...RECONCILED_GTA_PROSPECTS[0],
      id: "ledger-struthers",
      firmName: "Struthers Law from ledger",
      websiteUrl: "https://www.strutherslaw.ca/contact.html",
    }];
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.qualifiedImport).toMatchObject({ added: 19, updated: 1, ambiguous: 0 });
    expect(body.records.filter((record: { canonicalDomain?: string }) => record.canonicalDomain === "strutherslaw.ca")).toHaveLength(0);
    expect(body.records.find((record: { id: string }) => record.id === "ledger-struthers")).toMatchObject({
      firmName: "Struthers Law from ledger",
      firmId: null,
      observedLawyerCount: 2,
    });
  });

  it("uses an authoritative registry allocation for the visible shared identity and evidence source", async () => {
    h.state.session = { role: "operator" };
    h.state.records = [RECONCILED_GTA_PROSPECTS[0]];
    h.state.stableIdentities = [{
      sourceRecordKey: RECONCILED_GTA_PROSPECTS[0].id,
      firmId: "FIRM-7XGYP723JDAXDAB2J76RVNSVD5",
      canonicalDomain: "strutherslaw.ca",
      sourceUrl: "https://www.strutherslaw.ca/contact.html",
      observedOn: "2026-09-13",
      confidence: "high",
    }];

    const response = await GET();
    const body = await response.json();
    expect(body.records.find((record: { id: string }) => record.id === RECONCILED_GTA_PROSPECTS[0].id)).toMatchObject({
      firmId: "FIRM-7XGYP723JDAXDAB2J76RVNSVD5",
      canonicalDomain: "strutherslaw.ca",
      firmIdentity: {
        sourceUrl: "https://www.strutherslaw.ca/contact.html",
        observedOn: "2026-09-13",
        confidence: "high",
      },
    });
  });

  it("does not promote registry-only identity when an applied supplemental row has no confirmed observation", async () => {
    h.state.session = { role: "operator" };
    const sourceRecordKey = "q50-whole-firm-zarei-qualified-2026-09-25-v1";
    const databaseFirmId = "a9989dca-8626-4a6e-93ca-797a1cb7eed2";
    h.state.records = [{
      ...RECONCILED_GTA_PROSPECTS[0],
      id: sourceRecordKey,
      firmName: "Zarei Law Professional Corporation",
      firmId: null,
      canonicalDomain: null,
    }];
    h.state.stableIdentities = [{
      sourceRecordKey,
      firmId: "FIRM-B86000000000000000000000000",
      canonicalDomain: "zarei.example",
      sourceUrl: "https://zarei.example/identity",
      observedOn: "2026-09-25",
      confidence: "high",
    }];
    h.state.supplemental = [{
      sourceRecordKey,
      databaseFirmId,
      firmId: null,
      canonicalDomain: null,
      identity: null,
      websiteIntake: null,
      qualification: null,
    }];

    const response = await GET();
    const body = await response.json();
    const record = body.records.find((candidate: { id: string }) => candidate.id === sourceRecordKey);
    expect(record).toMatchObject({ databaseFirmId, firmId: null, canonicalDomain: null, firmIdentity: null, supplementalEvidence: { identity: null } });
  });

  it("returns a visible server error for a real ledger failure rather than concealing it as fallback", async () => {
    h.state.session = { role: "operator" };
    h.state.failure = new Error("permission denied");
    const response = await GET();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "GTA prospect research records could not be loaded." });
  });
});
