import { describe, expect, it, vi } from "vitest";
import { createProspectEnrichmentFixtures } from "@/lib/__fixtures__/prospect-enrichment-v1";
import { buildProspectEnrichmentClientItems } from "@/lib/prospect-enrichment-contract";
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
import { readPackageDetail, readPackageList, type ReadDatabase } from "../_package-read";
import { readRunDetail, readRunList } from "../_run-read";
import { prospectEnrichmentProtocolHash, prospectEnrichmentSha256, stableProspectEnrichmentJson } from "@/lib/prospect-enrichment-hash";
import type { ProspectEnrichmentEnvelope } from "@/lib/prospect-enrichment-contract";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
type Row = Record<string, unknown>;
function fakeDatabase(tables: Record<string, Row[]> = {}, rpcs: Record<string, Row[]> = {}, failed: string[] = []) {
  const calls: { name: string; args?: unknown; columns?: string }[] = [];
  const client = {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder = {
        select(columns: string) { calls.push({ name: table, columns }); return builder; },
        eq(key: string, value: unknown) { rows = rows.filter((row) => row[key] === value); return builder; },
        in(key: string, values: unknown[]) { rows = rows.filter((row) => values.includes(row[key])); return builder; },
        gt(key: string, value: string) { rows = rows.filter((row) => String(row[key]) > value); return builder; },
        or(value: string) { calls.push({ name: "or", args: value }); return builder; },
        order() { return builder; },
        limit(limit: number) { return Promise.resolve({ data: failed.includes(table) ? null : rows.slice(0, limit), error: failed.includes(table) ? { message: "synthetic read failure" } : null }); },
      };
      return builder;
    },
    rpc(name: string, args: unknown) {
      calls.push({ name, args });
      const input = args && typeof args === "object" ? args as Record<string, unknown> : {};
      const firms = tables.gta_prospect_firms ?? [], registries = tables.gta_prospect_stable_identity_registry ?? [];
      const ids = Array.isArray(input.p_firm_ids) ? input.p_firm_ids : [], keys = Array.isArray(input.p_source_record_keys) ? input.p_source_record_keys : [], stableIds = Array.isArray(input.p_stable_firm_ids) ? input.p_stable_firm_ids : [];
      const identityRows = firms.filter((firm) => ids.includes(firm.id) || keys.includes(firm.source_record_key) || registries.some((registry) => registry.firm_id === firm.id && stableIds.includes(registry.stable_firm_id)))
        .map((firm) => ({ firm_id: firm.id, source_record_key: firm.source_record_key, stable_firm_id: registries.find((registry) => registry.firm_id === firm.id)?.stable_firm_id ?? null, canonical_domain: registries.find((registry) => registry.firm_id === firm.id)?.canonical_domain ?? null, enrichment_revision: firm.enrichment_revision }));
      const protectedRows = (tables[String(input.p_table)] ?? []).filter((row) => String(input.p_table) === "gta_prospect_firms" ? row.id === input.p_firm_id : row.firm_id === input.p_firm_id)
        .filter((row) => typeof input.p_row_id !== "string" || row.id === input.p_row_id)
        .filter((row) => !Array.isArray(input.p_ids) || input.p_ids.includes(row.id))
        .filter((row) => typeof input.p_after_id !== "string" || String(row.id) > input.p_after_id)
        .slice(0, typeof input.p_limit === "number" ? input.p_limit : 100);
      const data = rpcs[name] ?? (name === "read_prospect_enrichment_firm_identities_v1" ? identityRows : name === "read_prospect_enrichment_gta_evidence_v1" ? protectedRows : name === "summarize_prospect_enrichment_manifest_hold_evidence_v1" ? [{ expected_evidence_count: 0, recorded_evidence_count: 0, mismatched_evidence_count: 0 }] : []);
      return Promise.resolve({ data: failed.includes(name) ? null : data, error: failed.includes(name) ? { message: "synthetic rpc failure" } : null });
    },
  } as unknown as ReadDatabase;
  return { client, calls };
}
function envelope(): ProspectEnrichmentEnvelope {
  const content = { candidate: "Enrichment Fixture", ownerVerified: false, unknown: null, contacts: [] };
  return { schemaVersion: "prospect-enrichment/v1", runId: "synthetic-run", packageId: "synthetic-package", supersedesPackageId: null, sourceSystem: "synthetic-research", sourceName: "synthetic-research", generatedAt: "2026-09-23T12:00:00.000Z", mode: "propose", subject: { researchKey: "enrichment-fixture-005", databaseFirmId: null, stableFirmId: null, sourceRecordKey: null, canonicalDomain: null, displayName: "Enrichment Fixture", identityState: "unresolved" }, sources: [], observations: [], assessment: null, originalResearch: { sourcePath: "synthetic/fixture.json", sourcePointer: "/candidate", sourceSha256: "a".repeat(64), contentSha256: prospectEnrichmentProtocolHash(content), content, unmappedPaths: ["/contacts", "/ownerVerified", "/unknown"] }, controls: { contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false } };
}
function packageRow(payload = envelope()): Row {
  const rawBody = JSON.stringify(payload);
  return { id: id(1), run_id: id(2), client_package_id: payload.packageId, firm_id: null, payload, payload_sha256: prospectEnrichmentProtocolHash(payload), raw_body: rawBody, raw_body_sha256: prospectEnrichmentSha256(rawBody), state: "identity_hold", identity_state: "unresolved", review_json: null, review_sha256: null, expected_revision_sha256: null, review_expires_at: null, apply_receipt: null, created_at: "2026-09-23T12:00:00.000Z" };
}
function runRow(): Row {
  return { run_id: id(2), run_key: "synthetic-run", source_name: "Synthetic research", created_at: "2026-09-23T12:00:00.000Z", candidate_count: 1, package_count: 1, package_state_counts: {}, visibility_counts: { packageVerified: 0, packageNotVerified: 0, canonicalVerified: 0, canonicalNotVerified: 0 }, needs_attention_count: 1, source_manifest_sha256: "b".repeat(64), manifest_sha256: "c".repeat(64), manifest_state: "finalized", manifest_expected_entry_count: 1, manifest_received_entry_count: 1, manifest_expected_package_count: 1, manifest_received_package_count: 1, missing_package_count: 0, payload_mismatch_count: 0, research_key_mismatch_count: 0, orphan_package_count: 0, manifest_registered_chunk_count: 1, manifest_expected_chunk_count: 1 };
}
function manifestRow(): Row {
  const item = { clientItemId: "obs:service-a", itemKind: "service", sourceEventKey: "service:" + "d".repeat(64), semanticSha256: "e".repeat(64) };
  return { entry_id: "entry-a", manifest_entry: { entryId: "entry-a", researchKey: "enrichment-fixture-005", clientPackageId: "expected-missing-package", expectedPayloadSha256: "f".repeat(64), itemCount: 1, clientItems: [item], initialDisposition: "ready_for_review", source: { sourceRoot: "synthetic", relativePath: "fixture.json", sourcePointer: "/candidate", fileSha256: "a".repeat(64) }, errorCodes: [] }, package_id: null, actual_payload_sha256: null, package_state: null, reconciliation_state: "missing_package", package_visibility_verified: false, canonical_visibility_verified: false, items: [{ ...item, itemId: null, actualSemanticSha256: null, disposition: "pending", reason: null, targets: [] }] };
}
describe("read-only package selectors", () => {
  it("keeps source items retained and profile selection off while exposing only supported asserted history", async () => {
    const original = envelope();
    const source: ProspectEnrichmentEnvelope["sources"][number] = { sourceId: "site", url: "https://enrichment-fixture-002.example/services", requestedUrl: "https://enrichment-fixture-002.example/services", finalUrl: "https://enrichment-fixture-002.example/services", policyState: "public-source", publicationLabel: null, publicationPrecision: "unknown", publisher: "Enrichment Fixture", observedAt: null, observedOn: "2026-09-23", retrievedAt: "2026-09-23T12:00:00.000Z", retrievalMethod: "http", retrievalOutcome: "success", httpStatus: 200, bodySha256: null, excerpt: "Synthetic corporate service", missingProvenanceReason: null };
    const observation: ProspectEnrichmentEnvelope["observations"][number] = { observationId: "service-a", evidenceState: "asserted", retractionReason: null, retractionSourceIds: [], missingProvenanceReason: null, kind: "service", observedAt: null, observedOn: "2026-09-23", sourceIds: ["site"], data: { name: "Corporate law", matterFit: "strong-match" }, existingRecord: null };
    const payload: ProspectEnrichmentEnvelope = { ...original, subject: { ...original.subject, identityState: "resolved", databaseFirmId: id(10) }, sources: [source], observations: [observation] };
    const row = packageRow(payload); row.firm_id = id(10); row.identity_state = "resolved"; row.state = "ready_for_review";
    const { client } = fakeDatabase({ prospect_enrichment_packages: [row], gta_prospect_firms: [{ id: id(10), source_record_key: "enrichment-fixture-010", display_name: "Enrichment Fixture", website_url: null, enrichment_revision: "0" }], prospect_enrichment_items: [{ id: id(30), package_id: id(1), client_item_id: "src:site", item_kind: "source", source_ids: ["site"], source_event_id: id(40), normalized_sha256: "a".repeat(64), data: source }, { id: id(31), package_id: id(1), client_item_id: "obs:service-a", item_kind: "service", source_ids: ["site"], source_event_id: id(41), normalized_sha256: "b".repeat(64), data: observation }] });
    const result = await readPackageDetail({ packageId: id(1), client });
    expect(result.items.find((item) => item.itemKind === "source")?.allowedDispositions).toEqual(["retain_only"]);
    expect(result.items.find((item) => item.itemKind === "service")?.allowedDispositions).toEqual(["accept_new", "retain_only"]);
    expect(result.items.every((item) => item.allowProfileChoice === false)).toBe(true);
    expect(result.sources[0].observedAt).toBeNull(); expect(result.sources[0].observedOn).toBe("2026-09-23");
  });

  it("derives one exact source-backed profile choice and never offers a service profile switch", async () => {
    const base = createProspectEnrichmentFixtures()[0].envelope;
    const payload = { ...base, subject: { ...base.subject, identityState: "resolved" as const, databaseFirmId: id(10), sourceRecordKey: "synthetic-existing" } };
    const row = packageRow(payload); row.firm_id = id(10); row.state = "ready_for_review";
    const values = [...payload.sources, ...payload.observations, payload.assessment!];
    const lineage = buildProspectEnrichmentClientItems(payload);
    const { client } = fakeDatabase({ prospect_enrichment_packages: [row], gta_prospect_firms: [{ id: id(10), source_record_key: "synthetic-existing", display_name: "Synthetic Legal 1", enrichment_revision: "0" }], prospect_enrichment_items: values.map((data, index) => ({ id: id(100 + index), package_id: id(1), client_item_id: lineage[index].clientItemId, item_kind: index === 0 ? "source" : index === values.length - 1 ? "assessment" : payload.observations[index - 1].kind, source_ids: "sourceIds" in data ? data.sourceIds : [], source_event_id: id(200 + index), normalized_sha256: lineage[index].semanticSha256, data })) });
    const result = await readPackageDetail({ packageId: id(1), client });
    const office = result.items.find((item) => item.itemKind === "firm_fit")!;
    expect(office.allowedProfileChoice).toEqual({ fieldKey: "office:obs:firm_fit", sourceSelector: "/data/office", selectedValue: { city: "Toronto", province: "ON", address: "Synthetic office" } });
    expect(office.currentValue).toMatchObject({ state: "empty", complete: true });
    expect(result.items.find((item) => item.itemKind === "service")?.allowedProfileChoice).toBeNull();
    expect(result.items.find((item) => item.itemKind === "contact")?.allowedProfileChoice).toMatchObject({ fieldKey: "contact:obs:contact", sourceSelector: "/data", selectedValue: { contactValue: "owner@enrichment-fixture-001.example", deliverability: "not-tested" } });
  });
  it("preserves held original research, raw bytes and explicit unknown values", async () => {
    const row = packageRow(), { client, calls } = fakeDatabase({ prospect_enrichment_packages: [row] });
    const result = await readPackageDetail({ packageId: id(1), client });
    expect(result.payload.originalResearch.content).toEqual({ candidate: "Enrichment Fixture", ownerVerified: false, unknown: null, contacts: [] });
    expect(result.rawBody).toBe(row.raw_body); expect(result.items).toEqual([]); expect(result.firmId).toBeNull();
    expect(result.identityOptions).toEqual([{ value: "unresolved", label: "Keep identity unresolved", eligible: true }]);
    expect(calls.every((call) => !call.name.includes("insert") && !call.name.includes("update"))).toBe(true);
  });
  it("fails closed if raw bytes, parsed payload or item coverage disagree", async () => {
    const row = packageRow(); row.raw_body_sha256 = "0".repeat(64);
    await expect(readPackageDetail({ packageId: id(1), client: fakeDatabase({ prospect_enrichment_packages: [row] }).client })).rejects.toThrow("integrity");
    const mismatched = packageRow(); mismatched.raw_body = "{}"; mismatched.raw_body_sha256 = prospectEnrichmentSha256("{}");
    await expect(readPackageDetail({ packageId: id(1), client: fakeDatabase({ prospect_enrichment_packages: [mismatched] }).client })).rejects.toThrow("do not agree");
    await expect(readPackageDetail({ packageId: id(1), client: fakeDatabase({ prospect_enrichment_packages: [packageRow()], prospect_enrichment_items: [{ id: id(3), package_id: id(1) }] }).client })).rejects.toThrow("coverage");
  });
  it("keeps conflicting supplied identities held without inventing a new core input", async () => {
    const original = envelope(), payload: ProspectEnrichmentEnvelope = { ...original, subject: { ...original.subject, identityState: "resolved", databaseFirmId: id(10), sourceRecordKey: "enrichment-fixture-011" } };
    const row = packageRow(payload); row.identity_state = "resolved"; row.firm_id = id(10);
    const { client } = fakeDatabase({ prospect_enrichment_packages: [row], gta_prospect_firms: [{ id: id(10), source_record_key: "enrichment-fixture-010", display_name: "Enrichment Fixture", website_url: null, enrichment_revision: "0" }, { id: id(11), source_record_key: "enrichment-fixture-011" }] });
    const result = await readPackageDetail({ packageId: id(1), client });
    expect(result.firmId).toBeNull(); expect(result.holds).toContain("identity_conflict"); expect(result.identityOptions?.some((option) => option.value === "new")).toBe(false);
  });
  it("keeps held review state independent of disqualification and paginates the full filter", async () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({ id: id(index + 20), run_id: id(2), client_package_id: "synthetic-" + index, display_name: "Enrichment Fixture " + index, firm_id: null, state: index === 2 ? "rejected" : "identity_hold", created_at: "2026-09-23T12:00:00.000Z", research_outcome: "partial", qualification: "disqualified" }));
    const { client } = fakeDatabase({ prospect_enrichment_packages: rows, prospect_enrichment_runs: [{ id: id(2), source_name: "Synthetic research" }] });
    const result = await readPackageList({ state: "held", limit: 1, client });
    expect(result.packages).toHaveLength(1); expect(result.packages[0].qualification).toBe("disqualified"); expect(result.packages[0].state).toBe("identity_hold"); expect(result.nextCursor).toBeTypeOf("string");
    await expect(readPackageList({ state: "applied", limit: 1, cursor: result.nextCursor!, client })).rejects.toThrow("does not belong");
  });
  it("does not turn a failed package query into an empty success", async () => {
    await expect(readPackageList({ state: "all", limit: 25, client: fakeDatabase({}, {}, ["prospect_enrichment_packages"]).client })).rejects.toThrow("could not be loaded");
  });
});
describe("manifest-backed run selectors", () => {
  it("supports a 100-row page without exceeding the RPC maximum and probes the next key", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({ ...runRow(), run_id: id(index + 100) }));
    const rpc = vi.fn().mockResolvedValueOnce({ data: rows, error: null }).mockResolvedValueOnce({ data: [], error: null });
    const result = await readRunList({ limit: 100, client: { rpc } as unknown as ReadDatabase });
    expect(result.runs).toHaveLength(100); expect(result.nextCursor).toBeNull();
    expect(rpc.mock.calls.map((call) => call[1].p_limit)).toEqual([100, 1]);
    expect(rpc.mock.calls[1][1].p_cursor_id).toBe(id(199));
  });

  it("returns missing expected packages and every pending item without dropping them", async () => {
    const row = runRow(); row.package_count = 0; row.manifest_received_package_count = 0; row.missing_package_count = 1;
    const { client } = fakeDatabase({}, { get_prospect_enrichment_run_summary_v1: [row], list_prospect_enrichment_run_manifest_items_v1: [manifestRow()] });
    const result = await readRunDetail({ runId: id(2), limit: 25, client });
    expect(result.summary).toMatchObject({ runId: id(2), sourceRunKey: "synthetic-run" });
    expect(result.summary.candidates).toBe(1); expect(result.summary.packages).toBe(0);
    expect(result.reconciliation.entries[0]).toMatchObject({ packageId: null, reconciliationState: "missing_package", items: [{ disposition: "pending", itemId: null }] });
    expect(result.reconciliation.inventoryState).toBe("incomplete"); expect(result.reconciliation.missingPackageCount).toBe(1); expect(result.summary.needsAttention).toBe(1);
  });
  it("reports complete only when the full package inventory is staged and identity and payload reconciliation are clean", async () => {
    const { client } = fakeDatabase({}, { get_prospect_enrichment_run_summary_v1: [runRow()], list_prospect_enrichment_run_manifest_items_v1: [manifestRow()] });
    const result = await readRunDetail({ runId: id(2), limit: 25, client });
    expect(result.reconciliation.inventoryState).toBe("complete");
    const orphaned = runRow(); orphaned.orphan_package_count = 1;
    const orphanRead = await readRunDetail({ runId: id(2), limit: 25, client: fakeDatabase({}, { get_prospect_enrichment_run_summary_v1: [orphaned], list_prospect_enrichment_run_manifest_items_v1: [manifestRow()] }).client });
    expect(orphanRead.reconciliation.inventoryState).toBe("incomplete"); expect(orphanRead.reconciliation.orphanPackageCount).toBe(1);
  });
  it("reads back and verifies original candidate evidence and issue reasons for package-less holds", async () => {
    const source = { sourceRoot: "synthetic", relativePath: "held.json", sourcePointer: "/firms/held", fileSha256: "a".repeat(64) };
    const core = { schemaVersion: "prospect-enrichment-held-candidate-evidence/v1", runId: "synthetic-run", entryId: "entry-held", researchKey: "synthetic-held", source, originalJson: stableProspectEnrichmentJson({ firmName: "Held Synthetic Firm", finding: "Raw finding retained" }), issues: [{ code: "identity_unresolved", path: "/firmId", reason: "No safe firm identity was established." }] };
    const evidenceSha256 = prospectEnrichmentProtocolHash({ schemaVersion: core.schemaVersion, entryId: core.entryId, researchKey: core.researchKey, source, originalJson: core.originalJson, issues: core.issues });
    const evidence = { ...core, evidenceSha256 };
    const entry = { entryId: core.entryId, researchKey: core.researchKey, clientPackageId: null, expectedPayloadSha256: null, itemCount: 0, clientItems: [], initialDisposition: "hold_schema", source, errorCodes: ["identity_unresolved", "__held_evidence_sha256:" + evidenceSha256] };
    const manifestRow = { entry_id: core.entryId, manifest_entry: entry, package_id: null, actual_payload_sha256: null, package_state: null, reconciliation_state: "source_hold", package_visibility_verified: false, canonical_visibility_verified: false, items: [] };
    const run = runRow(); Object.assign(run, { candidate_count: 1, package_count: 0, manifest_expected_entry_count: 1, manifest_received_entry_count: 1, manifest_expected_package_count: 0, manifest_received_package_count: 0, missing_package_count: 0 });
    const withEvidence = fakeDatabase({}, { get_prospect_enrichment_run_summary_v1: [run], list_prospect_enrichment_run_manifest_items_v1: [manifestRow], list_prospect_enrichment_manifest_hold_evidence_v1: [{ entry_id: core.entryId, evidence_sha256: evidenceSha256, evidence }], summarize_prospect_enrichment_manifest_hold_evidence_v1: [{ expected_evidence_count: 1, recorded_evidence_count: 1, mismatched_evidence_count: 0 }] });
    const result = await readRunDetail({ runId: id(2), limit: 25, client: withEvidence.client });
    expect(result.reconciliation.inventoryState).toBe("complete");
    expect(result.reconciliation.entries[0].heldEvidence).toMatchObject({ evidenceSha256, original: JSON.parse(core.originalJson), issues: core.issues });
    const missing = fakeDatabase({}, { get_prospect_enrichment_run_summary_v1: [run], list_prospect_enrichment_run_manifest_items_v1: [manifestRow], summarize_prospect_enrichment_manifest_hold_evidence_v1: [{ expected_evidence_count: 1, recorded_evidence_count: 0, mismatched_evidence_count: 1 }] });
    expect((await readRunDetail({ runId: id(2), limit: 25, client: missing.client })).reconciliation.inventoryState).toBe("incomplete");
    const corrupt = fakeDatabase({}, { get_prospect_enrichment_run_summary_v1: [run], list_prospect_enrichment_run_manifest_items_v1: [manifestRow], list_prospect_enrichment_manifest_hold_evidence_v1: [{ entry_id: core.entryId, evidence_sha256: "f".repeat(64), evidence }] });
    await expect(readRunDetail({ runId: id(2), limit: 25, client: corrupt.client })).rejects.toThrow("could not be verified");
  });
  it("does not mark an early run page complete when run-wide held evidence is missing", async () => {
    const run = runRow(); Object.assign(run, { manifest_expected_entry_count: 2, manifest_received_entry_count: 2 });
    const client = fakeDatabase({}, {
      get_prospect_enrichment_run_summary_v1: [run],
      list_prospect_enrichment_run_manifest_items_v1: [manifestRow()],
      summarize_prospect_enrichment_manifest_hold_evidence_v1: [{ expected_evidence_count: 1, recorded_evidence_count: 0, mismatched_evidence_count: 1 }],
    });
    const result = await readRunDetail({ runId: id(2), limit: 1, client: client.client });
    expect(result.reconciliation.inventoryState).toBe("incomplete");
  });
  it("treats an unregistered or incomplete inventory as incomplete despite visible packages", async () => {
    const row = runRow(); row.manifest_state = "open"; row.manifest_received_entry_count = 0;
    const { client } = fakeDatabase({}, { get_prospect_enrichment_run_summary_v1: [row], list_prospect_enrichment_run_manifest_items_v1: [] });
    expect((await readRunDetail({ runId: id(2), limit: 25, client })).reconciliation.inventoryState).toBe("incomplete");
  });
  it("requires complete item-level dispositions from the RPC", async () => {
    const entry = manifestRow(); entry.items = [];
    const { client } = fakeDatabase({}, { get_prospect_enrichment_run_summary_v1: [runRow()], list_prospect_enrichment_run_manifest_items_v1: [entry] });
    await expect(readRunDetail({ runId: id(2), limit: 25, client })).rejects.toThrow("coverage");
  });
  it("fails explicitly when run RPCs are unavailable", async () => {
    await expect(readRunList({ limit: 25, client: fakeDatabase({}, {}, ["list_prospect_enrichment_run_summaries_v1"]).client })).rejects.toThrow("could not be loaded");
  });
});
