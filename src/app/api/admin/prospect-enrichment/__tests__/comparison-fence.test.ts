import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
import type { ComparisonExportInput } from "../../../../../../scripts/prospect-enrichment/comparison-export";
import { prospectEnrichmentProtocolHash } from "@/lib/prospect-enrichment-hash";
import type { ReadDatabase } from "../_package-read";
import { verifyComparisonFinalFence, type ComparisonFenceBaseline } from "../_comparison-fence";

const runId = "00000000-0000-4000-8000-000000000001";
const targetId = "00000000-0000-4000-8000-000000000002";
const actor = "prospect-research-agent";

class FakeQuery {
  private filters: { kind: "eq" | "in"; column: string; value: unknown }[] = [];
  constructor(private readonly table: string, private readonly rowsFor: (table: string, filters: typeof this.filters) => Record<string, unknown>[]) {}
  select(_columns: string) { return this; }
  eq(column: string, value: unknown) { this.filters.push({ kind: "eq", column, value }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ kind: "in", column, value }); return this; }
  limit(_count: number) { return this; }
  then(resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve({ data: this.rowsFor(this.table, this.filters), error: null }).then(resolve, reject);
  }
}

function baseline(overrides: Partial<ComparisonFenceBaseline> = {}): ComparisonFenceBaseline {
  const snapshot = {
    schemaVersion: "prospect-enrichment-comparison/v1", projectId: "ssxryjxifwiivghglqer",
    capturedAt: "2026-09-23T12:00:00.000Z",
    provenance: { reader: "test", sourceArtifactSha256: "a".repeat(64), operatorAuthenticated: true },
    identities: [], packages: [], events: [],
  } as unknown as ComparisonExportInput;
  return { adminRunId: runId, actor, sourceSystem: "test-source", expectedPackageCount: 0,
    requestedPackageIds: [], expectedEventKeys: [], runPackages: [], actorPackages: [], eventPresence: [],
    eventItems: [], packageDetails: [], identities: [], snapshot, ...overrides };
}

function db(rowsFor: (table: string, filters: { kind: "eq" | "in"; column: string; value: unknown }[]) => Record<string, unknown>[]) {
  return { from: (table: string) => new FakeQuery(table, rowsFor) } as unknown as ReadDatabase;
}

describe("comparison final consistency fence", () => {
  it("rejects a target-row mutation committed after the second snapshot", async () => {
    const before = { id: targetId, firm_id: runId, count: 4 };
    const after = { ...before, count: 5 };
    const target = { table: "prospect_firm_fit_observations", id: targetId, rowSha256: prospectEnrichmentProtocolHash(before) };
    const snap = baseline({ snapshot: {
      ...baseline().snapshot,
      events: [{ sourceEventKey: "fit:event", semanticSha256: "b".repeat(64), researchKey: "research-1",
        targets: [target], primaryTarget: target, visible: true }],
    } as unknown as ComparisonExportInput });
    await expect(verifyComparisonFinalFence({ baseline: snap,
      client: db((table) => table === target.table ? [after] : []), envelopes: [], readIdentity: async () => [],
    })).rejects.toMatchObject({ status: 503 });
  });

  it("rejects a package that appears after the second snapshot reported it missing", async () => {
    const packageRow = { id: targetId, run_id: runId, client_package_id: "expected-package", submitted_by: actor,
      research_key: "research-1", payload: {}, payload_sha256: "c".repeat(64), state: "received", firm_id: null,
      raw_body_sha256: "d".repeat(64), review_json: null, review_sha256: null, expected_revision_sha256: null,
      review_expires_at: null, apply_receipt: null };
    const snap = baseline({ expectedPackageCount: 1, requestedPackageIds: ["expected-package"] });
    await expect(verifyComparisonFinalFence({ baseline: snap,
      client: db((table) => table === "prospect_enrichment_packages" ? [packageRow] : []), envelopes: [], readIdentity: async () => [],
    })).rejects.toMatchObject({ status: 503 });
  });

  it("accepts multiple legacy projection proofs that share one parent assessment and batch", async () => {
    const batchId = "00000000-0000-4000-8000-000000000003";
    const assessment = { id: targetId, firm_id: runId, evidence_import_batch_id: batchId, criteria: { score: 3 } };
    const target = { table: "gta_prospect_qualification_assessments", id: targetId, rowSha256: prospectEnrichmentProtocolHash(assessment) };
    const proof = { observationSourceEventKey: "observation:" + "e".repeat(64), observationSemanticSha256: "f".repeat(64),
      parentAssessmentClientId: "assessment:current", parentAssessmentTarget: target, databaseFirmId: runId,
      criteriaSelector: "/criteria/score", selectedValueSha256: prospectEnrichmentProtocolHash(3) };
    const snap = baseline({ snapshot: {
      ...baseline().snapshot,
      events: [{ sourceEventKey: "assessment:event", semanticSha256: "b".repeat(64), researchKey: "research-1",
        targets: [target], primaryTarget: target, visible: true, legacyAssessmentProjections: [proof, proof] }],
    } as unknown as ComparisonExportInput });
    await expect(verifyComparisonFinalFence({ baseline: snap,
      client: db((table) => table === target.table ? [assessment] : table === "gta_prospect_supplemental_evidence_import_batches" ? [{ id: batchId, state: "applied" }] : []),
      envelopes: [], readIdentity: async () => [],
    })).resolves.toBeUndefined();
  });
});
