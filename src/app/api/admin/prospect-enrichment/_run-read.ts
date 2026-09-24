import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { ResearchRunDetail, ResearchRunEntry, ResearchRunSummary, ResearchRunItemDisposition } from "@/app/admin/prospects/ResearchRunList";
import { databaseRows, datedCursor, decodeCursor, encodeCursor, isRecord, nullableText, ReadApiError, READ_UUID, requiredText } from "./_read-common";
import { readPackageList, type ReadDatabase } from "./_package-read";
import { prospectEnrichmentProtocolHash, stableProspectEnrichmentJson } from "@/lib/prospect-enrichment-hash";

function storedId(value: unknown): string { if (typeof value !== "string" || !READ_UUID.test(value)) throw new ReadApiError("A stored run identity is invalid."); return value.toLowerCase(); }

function count(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new ReadApiError("A research count could not be verified.");
  return Number(value);
}
function countGroup(value: unknown, keys: readonly string[], absentMeansZero = true) {
  if (!isRecord(value)) throw new ReadApiError("Research counts could not be loaded.");
  return keys.reduce((sum, key) => sum + count(absentMeansZero ? value[key] ?? 0 : value[key]), 0);
}
function runSummary(row: Record<string, unknown>): ResearchRunSummary {
  return {
    runId: storedId(row.run_id), sourceRunKey: requiredText(row.run_key, "source run key"), runName: requiredText(row.source_name, "run name"),
    candidates: count(row.candidate_count), packages: count(row.package_count),
    awaitingReview: countGroup(row.package_state_counts, ["received", "ready_for_review", "identity_hold", "evidence_hold"]),
    applied: countGroup(row.package_state_counts, ["applied"]), researchVisible: countGroup(row.visibility_counts, ["packageVerified"], false),
    canonicalVisibilityVerified: countGroup(row.visibility_counts, ["canonicalVerified"], false), needsAttention: count(row.needs_attention_count),
  };
}
export async function readRunList(input: { limit: number; cursor?: string; client?: ReadDatabase }): Promise<{ runs: ResearchRunSummary[]; nextCursor: string | null }> {
  const client = input.client ?? supabaseAdmin, cursor = datedCursor(input.cursor, "runs", "all");
  const values = databaseRows(await client.rpc("list_prospect_enrichment_run_summaries_v1", { p_limit: Math.min(input.limit + 1, 100), p_cursor_created_at: cursor?.createdAt ?? null, p_cursor_id: cursor?.id ?? null }));
  const page = values.slice(0, input.limit), last = page.at(-1);
  let hasMore = values.length > input.limit;
  if (input.limit === 100 && page.length === 100 && last) hasMore = databaseRows(await client.rpc("list_prospect_enrichment_run_summaries_v1", { p_limit: 1, p_cursor_created_at: requiredText(last.created_at, "run date"), p_cursor_id: storedId(last.run_id) })).length > 0;
  return { runs: page.map(runSummary), nextCursor: hasMore && last ? encodeCursor({ kind: "runs", scope: "all", createdAt: requiredText(last.created_at, "run date"), id: storedId(last.run_id) }) : null };
}
function manifestEntry(row: Record<string, unknown>): ResearchRunEntry {
  const entry = row.manifest_entry;
  if (!isRecord(entry) || !isRecord(entry.source) || !Array.isArray(entry.clientItems) || !Array.isArray(entry.errorCodes) || !Array.isArray(row.items)) throw new ReadApiError("The run inventory entry is incomplete.");
  const state = row.reconciliation_state;
  if (!["missing_package", "hash_mismatch", "staged", "rejected", "applied", "superseded", "source_hold", "retained_source_context"].includes(String(state))) throw new ReadApiError("The run reconciliation state is unsupported.");
  if (row.package_visibility_verified !== true && row.package_visibility_verified !== false) throw new ReadApiError("Package visibility was not reported.");
  if (row.canonical_visibility_verified !== true && row.canonical_visibility_verified !== false) throw new ReadApiError("Canonical visibility was not reported.");
  const itemCount = count(entry.itemCount);
  const clientItems = entry.clientItems.map((item) => {
    if (!isRecord(item)) throw new ReadApiError("The expected item inventory is incomplete.");
    return { clientItemId: requiredText(item.clientItemId, "client item identity"), itemKind: requiredText(item.itemKind, "item kind"), sourceEventKey: requiredText(item.sourceEventKey, "source event key"), semanticSha256: requiredText(item.semanticSha256, "item hash") };
  });
  const items: ResearchRunItemDisposition[] = row.items.map((item) => {
    if (!isRecord(item) || !["pending", "accept_new", "link_existing", "retain_only"].includes(String(item.disposition)) || !Array.isArray(item.targets)) throw new ReadApiError("A run item disposition could not be loaded.");
    return { ...item, clientItemId: requiredText(item.clientItemId, "client item identity"), itemKind: requiredText(item.itemKind, "item kind"), sourceEventKey: requiredText(item.sourceEventKey, "source event key"), semanticSha256: requiredText(item.semanticSha256, "expected item hash"), itemId: item.itemId === null ? null : storedId(item.itemId), actualSemanticSha256: nullableText(item.actualSemanticSha256, "actual item hash"), disposition: item.disposition as ResearchRunItemDisposition["disposition"], reason: nullableText(item.reason, "item reason"), targets: item.targets };
  });
  if (clientItems.length !== itemCount || items.length !== itemCount || new Set(items.map((item) => item.clientItemId)).size !== itemCount || clientItems.some((item) => !items.some((actual) => actual.clientItemId === item.clientItemId && actual.semanticSha256 === item.semanticSha256))) throw new ReadApiError("The run item disposition coverage is incomplete.");
  const initial = requiredText(entry.initialDisposition, "initial disposition");
  if (!["ready_for_review", "identity_hold", "evidence_hold", "hold_schema", "source_root_unavailable", "source_read_failed", "source_changed_during_snapshot", "reference_out_of_scope", "reference_provenance_only", "provenance_only"].includes(initial)) throw new ReadApiError("The initial inventory disposition is unsupported.");
  if (entry.errorCodes.some((value) => typeof value !== "string")) throw new ReadApiError("Inventory errors could not be loaded.");
  const entryId = requiredText(entry.entryId, "entry identity");
  if (entryId !== row.entry_id) throw new ReadApiError("The inventory entry identity does not match.");
  const heldEvidenceSha256 = entry.errorCodes.find((value) => typeof value === "string" && value.startsWith("__held_evidence_sha256:"))?.slice("__held_evidence_sha256:".length) ?? null;
  if (entry.errorCodes.filter((value) => typeof value === "string" && value.startsWith("__held_evidence_sha256:")).length > 1 ||
    (entry.clientPackageId === null && entry.researchKey !== null ? !/^[a-f0-9]{64}$/.test(String(heldEvidenceSha256)) : heldEvidenceSha256 !== null)) {
    throw new ReadApiError("The held-candidate evidence commitment is invalid.");
  }
  return {
    entryId, researchKey: nullableText(entry.researchKey, "research identity"), clientPackageId: nullableText(entry.clientPackageId, "client package identity"), expectedPayloadSha256: nullableText(entry.expectedPayloadSha256, "expected package hash"), itemCount, clientItems,
    initialDisposition: initial as ResearchRunEntry["initialDisposition"],
    source: { sourceRoot: typeof entry.source.sourceRoot === "string" ? entry.source.sourceRoot : nullableText(entry.source.sourceRoot, "source root"), relativePath: requiredText(entry.source.relativePath, "source path"), sourcePointer: typeof entry.source.sourcePointer === "string" ? entry.source.sourcePointer : (() => { throw new ReadApiError("The source pointer is missing."); })(), fileSha256: nullableText(entry.source.fileSha256, "source file hash") },
    errorCodes: (entry.errorCodes as string[]).filter((value) => !value.startsWith("__held_evidence_sha256:")), heldEvidenceSha256, heldEvidence: null, packageId: row.package_id === null ? null : storedId(row.package_id), actualPayloadSha256: nullableText(row.actual_payload_sha256, "actual package hash"), packageState: nullableText(row.package_state, "package state"),
    reconciliationState: state as ResearchRunEntry["reconciliationState"], packageVisibilityVerified: row.package_visibility_verified, canonicalVisibilityVerified: row.canonical_visibility_verified, items,
  };
}
export async function readRunDetail(input: { runId: string; limit: number; cursor?: string; entryCursor?: string; client?: ReadDatabase }): Promise<ResearchRunDetail> {
  const client = input.client ?? supabaseAdmin;
  const entryCursor = decodeCursor(input.entryCursor, "run-entries", input.runId);
  if (entryCursor && (Object.keys(entryCursor).sort().join(",") !== "entryId,kind,scope" || !entryCursor.entryId.length || entryCursor.entryId.length > 200 || /[\u0000-\u001f\u007f]/.test(entryCursor.entryId))) throw new ReadApiError("The inventory cursor is invalid.", 422);
  const [summaryRows, packages, entryRows, heldSummaryRows] = await Promise.all([
    client.rpc("get_prospect_enrichment_run_summary_v1", { p_run_id: input.runId }).then(databaseRows),
    readPackageList({ state: "all", limit: input.limit, cursor: input.cursor, runId: input.runId, client }),
    client.rpc("list_prospect_enrichment_run_manifest_items_v1", { p_run_id: input.runId, p_after_entry_id: entryCursor?.entryId ?? null, p_limit: Math.min(input.limit + 1, 100) }).then(databaseRows),
    client.rpc("summarize_prospect_enrichment_manifest_hold_evidence_v1", { p_run_id: input.runId }).then(databaseRows),
  ]);
  if (!summaryRows.length) throw new ReadApiError("The research run was not found.", 404);
  if (summaryRows.length !== 1 || summaryRows[0].run_id !== input.runId) throw new ReadApiError("The research run identity could not be verified.");
  if (heldSummaryRows.length !== 1) throw new ReadApiError("Run-wide held-candidate evidence coverage could not be verified.");
  const heldExpected = count(heldSummaryRows[0].expected_evidence_count), heldRecorded = count(heldSummaryRows[0].recorded_evidence_count), heldMismatched = count(heldSummaryRows[0].mismatched_evidence_count);
  const row = summaryRows[0], page = entryRows.slice(0, input.limit), last = page.at(-1);
  const candidateHoldIds = page.filter((value) => isRecord(value.manifest_entry) && value.manifest_entry.clientPackageId === null && value.manifest_entry.researchKey !== null).map((value) => requiredText(value.entry_id, "entry identity"));
  const heldRows = candidateHoldIds.length ? databaseRows(await client.rpc("list_prospect_enrichment_manifest_hold_evidence_v1", { p_run_id: input.runId, p_entry_ids: candidateHoldIds })) : [];
  if (new Set(heldRows.map((value) => value.entry_id)).size !== heldRows.length || heldRows.some((value) => !candidateHoldIds.includes(String(value.entry_id)))) throw new ReadApiError("Held-candidate evidence did not match the requested run page.");
  const heldByEntry = new Map(heldRows.map((value) => [String(value.entry_id), value]));
  const entries = page.map((value) => {
    const parsed = manifestEntry(value), held = heldByEntry.get(parsed.entryId);
    if (!parsed.heldEvidenceSha256) return parsed;
    if (!held) return parsed;
    const evidence = held.evidence;
    if (!isRecord(evidence) || evidence.schemaVersion !== "prospect-enrichment-held-candidate-evidence/v1" || evidence.runId !== requiredText(row.run_key, "run key") || evidence.entryId !== parsed.entryId || evidence.researchKey !== parsed.researchKey ||
      held.evidence_sha256 !== parsed.heldEvidenceSha256 || evidence.evidenceSha256 !== parsed.heldEvidenceSha256 || !isRecord(evidence.source) || typeof evidence.originalJson !== "string" || !Array.isArray(evidence.issues)) throw new ReadApiError("Held-candidate evidence is incomplete or mismatched.");
    let original: unknown;
    try { original = JSON.parse(evidence.originalJson); if (stableProspectEnrichmentJson(original) !== evidence.originalJson) throw new Error("noncanonical"); }
    catch { throw new ReadApiError("Held-candidate original JSON could not be verified."); }
    const core = { ...evidence };
    delete core.evidenceSha256;
    delete core.runId;
    if (prospectEnrichmentProtocolHash(core) !== parsed.heldEvidenceSha256 || prospectEnrichmentProtocolHash(evidence.source) !== prospectEnrichmentProtocolHash(parsed.source) || evidence.issues.some((issue) => !isRecord(issue) || typeof issue.code !== "string" || typeof issue.path !== "string" || typeof issue.reason !== "string")) throw new ReadApiError("Held-candidate evidence hash or provenance could not be verified.");
    return { ...parsed, heldEvidence: { evidenceSha256: parsed.heldEvidenceSha256, original, issues: evidence.issues } };
  });
  let entriesHaveMore = entryRows.length > input.limit;
  if (input.limit === 100 && page.length === 100 && last) entriesHaveMore = databaseRows(await client.rpc("list_prospect_enrichment_run_manifest_items_v1", { p_run_id: input.runId, p_after_entry_id: requiredText(last.entry_id, "entry identity"), p_limit: 1 })).length > 0;
  const missing = row.manifest_sha256 === null;
  const expectedEntryCount = missing ? 0 : count(row.manifest_expected_entry_count), receivedEntryCount = count(row.manifest_received_entry_count);
  const expectedPackageCount = missing ? 0 : count(row.manifest_expected_package_count);
  const receivedPackageCount = missing ? 0 : count(row.manifest_received_package_count);
  const stagedPackageCount = count(row.package_count);
  const missingPackageCount = count(row.missing_package_count);
  const payloadMismatchCount = count(row.payload_mismatch_count);
  const researchKeyMismatchCount = count(row.research_key_mismatch_count);
  const orphanPackageCount = count(row.orphan_package_count);
  const inventoryState = missing ? "missing" : row.manifest_state === "finalized" && expectedEntryCount === receivedEntryCount &&
    count(row.manifest_registered_chunk_count) === count(row.manifest_expected_chunk_count) && heldExpected === heldRecorded && heldMismatched === 0 && entries.every((entry) => !entry.heldEvidenceSha256 || entry.heldEvidence !== null) &&
    receivedPackageCount === expectedPackageCount && stagedPackageCount === expectedPackageCount &&
    missingPackageCount === 0 && payloadMismatchCount === 0 && researchKeyMismatchCount === 0 && orphanPackageCount === 0 ? "complete" : "incomplete";
  return {
    summary: runSummary(row), packages: packages.packages, nextCursor: packages.nextCursor,
    reconciliation: { inventoryState, manifestSha256: nullableText(row.manifest_sha256, "manifest hash"), sourceManifestSha256: nullableText(row.source_manifest_sha256, "source manifest hash"), expectedEntryCount, receivedEntryCount, expectedPackageCount, receivedPackageCount, stagedPackageCount, missingPackageCount, payloadMismatchCount, researchKeyMismatchCount, orphanPackageCount, entries, nextEntryCursor: entriesHaveMore && last ? encodeCursor({ kind: "run-entries", scope: input.runId, entryId: requiredText(last.entry_id, "entry identity") }) : null },
  };
}
