import { describe, expect, it } from "vitest";
import { parseProspectEnrichmentEnvelope } from "@/lib/prospect-enrichment-contract";
import { prospectEnrichmentProtocolHash, prospectEnrichmentIdempotencyKey, stableProspectEnrichmentJson } from "@/lib/prospect-enrichment-hash";

const sourceContent = {
  firm: "Example Legal",
  findings: [{ field: "owner", status: "not_observed" }],
};

type MutableEnvelopeFixture = {
  [key: string]: unknown;
  sources: unknown[];
  observations: unknown[];
  assessment: unknown;
  originalResearch: Record<string, unknown>;
};

function envelope(): MutableEnvelopeFixture {
  return {
    schemaVersion: "prospect-enrichment/v1",
    runId: "run-20260923-a",
    packageId: "pkg-example-001",
    supersedesPackageId: null,
    sourceSystem: "luna-plan-qualification",
    sourceName: "prospect-research",
    generatedAt: "2026-09-23T16:00:00Z",
    mode: "propose",
    subject: {
      researchKey: "Example Legal | https://example.example",
      databaseFirmId: null,
      stableFirmId: null,
      sourceRecordKey: null,
      canonicalDomain: "example.example",
      displayName: "Example Legal",
      identityState: "unresolved",
    },
    sources: [],
    observations: [],
    assessment: null,
    originalResearch: {
      sourcePath: "qualification-runs/firm/example.json",
      sourceSha256: "a".repeat(64),
      sourcePointer: "/firms/0",
      contentSha256: prospectEnrichmentProtocolHash(sourceContent),
      content: sourceContent,
      unmappedPaths: ["/findings/0/field", "/findings/0/status"],
    },
    controls: { contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false },
  } as MutableEnvelopeFixture;
}

describe("prospect enrichment v1 contract", () => {
  it("accepts and preserves complete source material even when typed projections are empty", () => {
    const input = envelope();
    const parsed = parseProspectEnrichmentEnvelope(input);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.envelope.originalResearch.content).toEqual(sourceContent);
  });

  it("accepts date-only facts without inventing a timestamp", () => {
    const input = envelope();
    input.sources = [{
      sourceId: "firm-site-team",
      url: "https://example.example/team",
      requestedUrl: "https://example.example/team",
      finalUrl: "https://example.example/team",
      policyState: "public-source",
      publicationLabel: null,
      publicationPrecision: "unknown",
      publisher: "Example Legal",
      observedAt: null,
      observedOn: "2026-09-20",
      retrievedAt: "2026-09-23T15:00:00Z",
      retrievalMethod: "public_html",
      retrievalOutcome: "success-positive",
      httpStatus: 200,
      bodySha256: "b".repeat(64),
      excerpt: "Our team",
      missingProvenanceReason: null,
    }];
    input.observations = [{
      observationId: "team-roster-20260920",
      evidenceState: "asserted",
      retractionReason: null,
      retractionSourceIds: [],
      missingProvenanceReason: null,
      kind: "roster",
      observedAt: null,
      observedOn: "2026-09-20",
      sourceIds: ["firm-site-team"],
      data: { lawyerCount: 3, countQualifier: "exact", display: "3 lawyers", includedNames: ["A. Example"], excludedPeople: [] },
      existingRecord: null,
    }];
    input.originalResearch.contentSha256 = prospectEnrichmentProtocolHash({ original: "date-only fixture" });
    input.originalResearch.content = { original: "date-only fixture" };

    const parsed = parseProspectEnrichmentEnvelope(input);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.envelope.observations[0].observedAt).toBeNull();
  });

  it("rejects unknown envelope keys rather than silently dropping them", () => {
    const input = { ...envelope(), surprise: true };
    const parsed = parseProspectEnrichmentEnvelope(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues).toContainEqual({ path: "surprise", message: "unrecognized field is forbidden" });
  });

  it("rejects content hashes that do not match the preserved original object", () => {
    const input = envelope();
    input.originalResearch.contentSha256 = "c".repeat(64);
    const parsed = parseProspectEnrichmentEnvelope(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.some((issue) => issue.path === "originalResearch.contentSha256")).toBe(true);
  });

  it("rejects dangling source references and inconsistent roster counts", () => {
    const input = envelope();
    input.observations = [{
      observationId: "roster-001",
      evidenceState: "asserted",
      retractionReason: null,
      retractionSourceIds: [],
      missingProvenanceReason: null,
      kind: "roster",
      observedAt: null,
      observedOn: "2026-09-20",
      sourceIds: ["missing-source"],
      data: { lawyerCount: null, countQualifier: "exact", display: "unknown", includedNames: [], excludedPeople: [] },
      existingRecord: null,
    }];
    input.originalResearch.contentSha256 = prospectEnrichmentProtocolHash(sourceContent);

    const parsed = parseProspectEnrichmentEnvelope(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues.some((issue) => issue.path === "observations[0].sourceIds[0]")).toBe(true);
      expect(parsed.issues.some((issue) => issue.path === "observations[0].data.lawyerCount")).toBe(true);
    }
  });

  it("requires retractions to retain a reason and supporting provenance", () => {
    const input = envelope();
    input.observations = [{
      observationId: "retracted-email-001",
      evidenceState: "retracted",
      retractionReason: null,
      retractionSourceIds: [],
      missingProvenanceReason: null,
      kind: "research_attempt",
      observedAt: null,
      observedOn: null,
      sourceIds: [],
      data: { provider: "directory", queryOrUrl: "https://example.example", outcome: "email claim invalid", coverage: "partial", failureReason: null },
      existingRecord: null,
    }];

    expect(parseProspectEnrichmentEnvelope(input).ok).toBe(false);
  });

  it("preserves rich legacy criteria and rejects prototype-sensitive keys", () => {
    const rich = JSON.parse('{"status":"needs_evidence","observedLawyers":3,"missingGates":["owner_role"],"evidence":{"sourceUrl":"https://example.example/team"}}');
    const input = envelope();
    input.assessment = {
      assessmentId: "assessment-001",
      cohortId: "cohort-2026-09",
      ruleVersion: "qualification-v1",
      assessedAt: null,
      assessedOn: "2026-09-23",
      missingProvenanceReason: null,
      researchOutcome: "partial",
      advertisingStatus: null,
      advertisingStatusState: "unknown",
      fitDecision: "unknown",
      commercialRelevance: "unknown",
      decisionMakerAccess: "unknown",
      opportunityDecision: "unknown",
      selectionDisposition: "verification-required",
      missingGates: ["owner_role"],
      researchFailures: [],
      rationale: "Owner role remains unverified.",
      sourceIds: [],
      legacyCriteria: rich,
      existingRecord: null,
    };
    expect(parseProspectEnrichmentEnvelope(input).ok).toBe(true);

    const unsafe = envelope();
    unsafe.originalResearch.content = JSON.parse('{"__proto__":{"polluted":true}}');
    unsafe.originalResearch.contentSha256 = prospectEnrichmentProtocolHash(unsafe.originalResearch.content);
    expect(parseProspectEnrichmentEnvelope(unsafe).ok).toBe(false);
  });

  it("uses sorted recursive object keys and stable package idempotency keys", () => {
    expect(stableProspectEnrichmentJson({ z: 1, a: { y: true, b: "x" } })).toBe('{"a":{"b":"x","y":true},"z":1}');
    expect(prospectEnrichmentIdempotencyKey("luna", "run-1", "package-1")).toBe(prospectEnrichmentIdempotencyKey("luna", "run-1", "package-1"));
    expect(prospectEnrichmentIdempotencyKey("luna", "run-1", "package-1")).not.toBe(prospectEnrichmentIdempotencyKey("luna", "run-1", "package-2"));
  });
});
