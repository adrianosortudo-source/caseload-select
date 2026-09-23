import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));

import { buildProspectEnrichmentClientItems } from "../../../src/lib/prospect-enrichment-contract";
import { buildProspectEnrichmentItemInputs } from "../../../src/lib/prospect-enrichment-store";
import { compileCandidate } from "../compiler";
import { buildExpectedRunManifest, chunkExpectedRunManifest } from "../run-manifest";
import { items } from "../reconciliation";
import { candidate, sample, snapshot } from "../fixtures/synthetic";
import { canonicalJson } from "../model";

describe("one cross-module client lineage contract", () => {
  it("store, manifest export and reconciliation have byte-identical complete item identity and hashes", () => {
    const compiled = compileCandidate(candidate(sample()), snapshot);
    const source = { schemaVersion: "prospect-backfill-manifest/v1" as const, ...snapshot, roots: [], artifacts: [], issues: [] };
    const coverage = [{ researchKey: compiled.researchKey, sourceRoot: "root-a", relativePath: "synthetic.json", sourcePointer: "", sourceSha256: "b".repeat(64), packageIds: compiled.packages.map(p => p.envelope.packageId), issues: [] }];
    const expected = buildExpectedRunManifest(source, compiled.packages, coverage, []);
    const chunks = chunkExpectedRunManifest(expected);
    for (const p of compiled.packages) {
      const shared = buildProspectEnrichmentClientItems(p.envelope);
      const input = buildProspectEnrichmentItemInputs(p.envelope);
      const store = [...input.sources.map(s => ({ clientItemId: s.clientItemId, itemKind: "source", sourceEventKey: s.sourceEventKey, semanticSha256: s.semanticSha256 })), ...input.items.map(i => ({ clientItemId: i.clientItemId, itemKind: i.itemKind, sourceEventKey: i.sourceEventKey, semanticSha256: i.semanticSha256 }))];
      const reconciled = items(p.envelope).map(i => ({ clientItemId: i.id, itemKind: i.kind, sourceEventKey: i.sourceEventKey, semanticSha256: i.semanticSha256 }));
      const manifest = chunks.flatMap(c => c.entries).find(e => e.clientPackageId === p.envelope.packageId)!.clientItems;
      expect(canonicalJson(store)).toBe(canonicalJson(shared));
      expect(canonicalJson(reconciled)).toBe(canonicalJson(shared));
      expect(canonicalJson(manifest)).toBe(canonicalJson(shared));
    }
  });
  it("a source date change alters citing semantic hashes without changing immutable event keys", () => {
    const compiled = compileCandidate(candidate(sample()), snapshot).packages.find(p => p.envelope.observations.length)!;
    const before = buildProspectEnrichmentClientItems(compiled.envelope);
    const source = compiled.envelope.sources[0];
    const changed = { ...compiled.envelope, sources: compiled.envelope.sources.map(s => s.sourceId === source.sourceId ? { ...s, observedOn: "2026-09-22" } : s) };
    const after = buildProspectEnrichmentClientItems(changed);
    expect(before.map(i => i.sourceEventKey)).toEqual(after.map(i => i.sourceEventKey));
    const citation = compiled.envelope.observations.find(o => o.sourceIds.includes(source.sourceId))!;
    const index = before.findIndex(i => i.clientItemId === "obs:" + citation.observationId);
    expect(before[index].semanticSha256).not.toBe(after[index].semanticSha256);
  });
});
