import { describe, expect, it, vi } from "vitest";
import type { ProspectEnrichmentEnvelope } from "@/lib/prospect-enrichment-contract";
import { prospectEnrichmentPayloadSha256 } from "@/lib/prospect-enrichment-hash";
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
import { stageProspectEnrichmentPackage, ProspectEnrichmentStoreError } from "@/lib/prospect-enrichment-store";

const packageId = "11111111-1111-4111-8111-111111111111";
const receivedAt = "2026-09-23T16:00:00.000Z";
const envelope = {
  schemaVersion: "prospect-enrichment/v1",
  runId: "run-20260923-a",
  packageId: "pkg-example-001",
  supersedesPackageId: null,
  sourceSystem: "luna-plan-qualification",
  sourceName: "prospect-research",
  generatedAt: receivedAt,
  mode: "propose",
  subject: { researchKey: "Example Legal", databaseFirmId: null, stableFirmId: null, sourceRecordKey: null, canonicalDomain: null, displayName: "Example Legal", identityState: "unresolved" },
  sources: [],
  observations: [],
  assessment: null,
  originalResearch: { sourcePath: "research/example.json", sourceSha256: "a".repeat(64), sourcePointer: "/firms/0", contentSha256: "b".repeat(64), content: {}, unmappedPaths: [] },
  controls: { contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false },
} as unknown as ProspectEnrichmentEnvelope;

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "replayed",
    packageId,
    clientPackageId: envelope.packageId,
    runId: envelope.runId,
    payloadSha256: prospectEnrichmentPayloadSha256(envelope),
    state: "applied",
    identityState: "unresolved",
    counts: { sources: 0, observations: 0, assessments: 0, items: 0 },
    receivedAt,
    ...overrides,
  };
}

describe("prospect enrichment staging receipts", () => {
  it("accepts a replay receipt after the package has reached a terminal state", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: receipt(), error: null });
    const result = await stageProspectEnrichmentPackage({ submittedBy: "luna-runner", rawBody: "{}", envelope, client: { rpc } as never });

    expect(result).toMatchObject({ outcome: "replayed", packageId, clientPackageId: envelope.packageId, runId: envelope.runId, state: "applied", counts: { sources: 0, observations: 0, assessments: 0, items: 0 } });
  });

  it("rejects a database receipt whose identity, payload hash or counts do not match the submitted envelope", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: receipt({ payloadSha256: "c".repeat(64), counts: { sources: 0, observations: 0, assessments: 0, items: 1 } }), error: null });

    await expect(stageProspectEnrichmentPackage({ submittedBy: "luna-runner", rawBody: "{}", envelope, client: { rpc } as never })).rejects.toMatchObject({
      name: "ProspectEnrichmentStoreError", status: 503, code: "invalid_database_receipt",
    } satisfies Partial<ProspectEnrichmentStoreError>);
  });
});
