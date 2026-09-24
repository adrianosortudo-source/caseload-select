import type { NextRequest } from "next/server";
import { buildProspectEnrichmentClientItems, parseProspectEnrichmentEnvelope, type ProspectEnrichmentEnvelope } from "@/lib/prospect-enrichment-contract";
import { prospectEnrichmentProtocolHash as hash } from "@/lib/prospect-enrichment-hash";
import { prospectEnrichmentJson, readBoundedJson, requireProspectEnrichmentOperator } from "@/lib/prospect-enrichment-auth";
import { prospectEnrichmentAgentActor } from "@/lib/prospect-enrichment-agent-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { serializeComparisonExport, type ComparisonExportInput } from "../../../../../../scripts/prospect-enrichment/comparison-export";
import type { Target } from "../../../../../../scripts/prospect-enrichment/reconciliation";
import { validateLegacyAssessmentProjectionClaims, type LegacyAssessmentProjectionClaim } from "../../../../../../scripts/prospect-enrichment/legacy-projections";
import { readPackageDetail, type ReadDatabase } from "../_package-read";
import { readProspectLegacyAssessmentProjectionProof } from "../_legacy-projection-read";
import { buildProspectEnrichmentVerification } from "../_verify-readback";
import { requireRegisteredRunManifest, type RegisteredRunManifest } from "../_comparison-manifest";
import { comparisonContentFingerprint, matchesPackageReadBack } from "../_comparison-integrity";
import { verifyComparisonFinalFence, type ComparisonFenceBaseline } from "../_comparison-fence";
import { readIdentity } from "../_comparison-identity";
import { databaseRows, isRecord, ReadApiError, READ_UUID } from "../_read-common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const REQUEST_SCHEMA = "prospect-enrichment-comparison-request/v1";
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
type Db = ReadDatabase;
type RequestPackage = { envelope: ProspectEnrichmentEnvelope; payloadSha256: string; legacyAssessmentProjectionClaims: LegacyAssessmentProjectionClaim[] };
type ComparisonRequest = { schemaVersion: typeof REQUEST_SCHEMA; manifest: RegisteredRunManifest; packages: RequestPackage[] };

function exactKeys(value: Record<string, unknown>, required: readonly string[]) { return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key)); }
function fail(message: string, status: 422 | 503 = 422): never { throw new ReadApiError(message, status); }
function same(a: unknown, b: unknown) { return hash(a) === hash(b); }

function parseRequest(value: unknown): ComparisonRequest {
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "manifest", "packages"]) || value.schemaVersion !== REQUEST_SCHEMA || !isRecord(value.manifest) || !Array.isArray(value.packages)) fail("The comparison request is structurally invalid.");
  const manifest = value.manifest;
  if (!exactKeys(manifest, ["schemaVersion", "runId", "sourceSystem", "sourceName", "sourceManifestSha256", "generatedAt", "expectedPackageCount", "entries", "manifestSha256"]) || manifest.schemaVersion !== "prospect-enrichment-run-manifest/v1" || typeof manifest.runId !== "string" || typeof manifest.sourceSystem !== "string" || typeof manifest.sourceName !== "string" || !HASH.test(String(manifest.sourceManifestSha256)) || typeof manifest.generatedAt !== "string" || !Array.isArray(manifest.entries) || manifest.entries.length > 10000 || !Number.isSafeInteger(manifest.expectedPackageCount) || !HASH.test(String(manifest.manifestSha256))) fail("The frozen source manifest is incomplete or invalid.");
  const { manifestSha256, ...manifestContent } = manifest;
  if (hash(manifestContent) !== manifestSha256) fail("The frozen source manifest hash does not match its contents.");
  if (value.packages.length > 1000) fail("The comparison request exceeds the package limit.");
  const entries = manifest.entries as unknown[];
  if (entries.some((entry) => !isRecord(entry) || typeof entry.entryId !== "string" || !(typeof entry.clientPackageId === "string" || entry.clientPackageId === null) || !(typeof entry.researchKey === "string" || entry.researchKey === null) || !Array.isArray(entry.clientItems))) fail("A frozen manifest entry is incomplete.");
  const expected = new Map<string, Record<string, unknown>>();
  for (const entry of entries as Record<string, unknown>[]) if (typeof entry.clientPackageId === "string") { if (expected.has(entry.clientPackageId)) fail("The frozen manifest repeats a package identity."); expected.set(entry.clientPackageId, entry); }
  if (expected.size !== manifest.expectedPackageCount || value.packages.length !== expected.size) fail("The request does not cover every package in the frozen manifest.");
  const packages: RequestPackage[] = [], seen = new Set<string>();
  for (const raw of value.packages) {
    if (!isRecord(raw) || !exactKeys(raw, ["envelope", "payloadSha256", "legacyAssessmentProjectionClaims"]) || !HASH.test(String(raw.payloadSha256)) || !Array.isArray(raw.legacyAssessmentProjectionClaims)) fail("A package comparison request is incomplete.");
    const parsed = parseProspectEnrichmentEnvelope(raw.envelope);
    if (!parsed.ok) fail("A comparison package envelope is invalid.");
    const envelope = parsed.envelope, entry = expected.get(envelope.packageId);
    const lineage = buildProspectEnrichmentClientItems(envelope).map((item) => ({ clientItemId: item.clientItemId, itemKind: item.itemKind, sourceEventKey: item.sourceEventKey, semanticSha256: item.semanticSha256 }));
    if (envelope.runId !== manifest.runId || envelope.sourceSystem !== manifest.sourceSystem || envelope.sourceName !== manifest.sourceName || seen.has(envelope.packageId) || hash(envelope) !== raw.payloadSha256 || !entry || entry.expectedPayloadSha256 !== raw.payloadSha256 || entry.researchKey !== envelope.subject.researchKey || entry.itemCount !== lineage.length || !same(entry.clientItems, lineage)) fail("A package does not match its frozen manifest identity or hash.");
    const claims = raw.legacyAssessmentProjectionClaims as LegacyAssessmentProjectionClaim[];
    if (validateLegacyAssessmentProjectionClaims(envelope, claims).length) fail("Legacy projection claims do not match original package evidence.");
    packages.push({ envelope, payloadSha256: String(raw.payloadSha256), legacyAssessmentProjectionClaims: claims }); seen.add(envelope.packageId);
  }
  return { schemaVersion: REQUEST_SCHEMA, manifest: manifest as unknown as RegisteredRunManifest, packages };
}

const primaryTables: Readonly<Record<string, readonly string[]>> = {
  source: ["prospect_source_captures"], firm_fit: ["prospect_firm_fit_observations"], service: ["prospect_service_observations"],
  contact: ["prospect_decision_maker_contacts", "gta_prospect_public_contact_observations"], advertising: ["prospect_advertising_observations"],
  opportunity: ["prospect_opportunity_observations"], website_intake: ["gta_prospect_website_intake_observations"], roster: ["gta_prospect_roster_observations"],
  research_attempt: ["prospect_research_attempts"], assessment: ["gta_prospect_qualification_assessments", "prospect_qualification_decisions"],
};
function choosePrimary(kind: string, targets: Target[]): Target | null { const matches = targets.filter((target) => (primaryTables[kind] ?? []).includes(target.table)); return matches.length === 1 ? matches[0] : null; }

async function eventEvidence(eventId: string, sourceSystem: string, client: Db, cache: Map<string, Awaited<ReturnType<typeof readPackageDetail>>>, readSet: unknown[]) {
  const items = databaseRows(await client.from("prospect_enrichment_items").select("id,package_id,source_event_id,client_item_id,item_kind,data,source_ids,normalized_sha256").eq("source_event_id", eventId).limit(1001));
  if (items.length > 1000) fail("Complete event history exceeds the comparison limit.", 503);
  readSet.push({ eventId, items: items.map((item) => ({ id: item.id, packageId: item.package_id, sourceEventId: item.source_event_id, clientItemId: item.client_item_id, itemKind: item.item_kind, data: item.data, sourceIds: item.source_ids, normalizedSha256: item.normalized_sha256 })).sort((a, b) => String(a.id).localeCompare(String(b.id))) });
  if (!items.length) return { targets: [] as Target[], primary: null as Target | null, researchKeys: [] as string[], kinds: [] as string[], visible: null as boolean | null, parentClientId: undefined as string | undefined };
  const packageRows = databaseRows(await client.from("prospect_enrichment_packages").select("id,client_package_id,submitted_by,payload,payload_sha256,state").in("id", [...new Set(items.map((item) => String(item.package_id)))]).limit(items.length + 1));
  const actor = prospectEnrichmentAgentActor();
  if (packageRows.some((row) => row.submitted_by !== actor)) return { targets: [] as Target[], primary: null as Target | null, researchKeys: [] as string[], kinds: [...new Set(items.map((item) => String(item.item_kind)))], visible: null as boolean | null, parentClientId: undefined as string | undefined };
  const targets: Target[] = [], researchKeys = new Set<string>(), kinds = new Set<string>();
  let visible = true, unverifiable = false, parentClientId: string | undefined;
  for (const row of packageRows) {
    const parsed = parseProspectEnrichmentEnvelope(row.payload);
    if (!parsed.ok || parsed.envelope.sourceSystem !== sourceSystem) { unverifiable = true; continue; }
    researchKeys.add(parsed.envelope.subject.researchKey);
    let detail = cache.get(String(row.id));
    if (!detail) { detail = await readPackageDetail({ packageId: String(row.id), client }); cache.set(String(row.id), detail); }
    if (!matchesPackageReadBack(row, detail)) { unverifiable = true; continue; }
    const lineages = buildProspectEnrichmentClientItems(parsed.envelope);
    for (const stored of items.filter((item) => item.package_id === row.id)) {
      const lineage = lineages.find((item) => item.clientItemId === stored.client_item_id);
      const detailItem = detail.items.find((item) => item.itemId === stored.id);
      if (!lineage || !detailItem || lineage.itemKind !== stored.item_kind || lineage.semanticSha256 !== stored.normalized_sha256) { visible = false; continue; }
      kinds.add(lineage.itemKind);
      if (lineage.itemKind === "assessment") parentClientId = lineage.clientItemId;
      const linked = detailItem.targets.flatMap((target) => isRecord(target) && typeof target.target_table === "string" && typeof target.target_id === "string" && READ_UUID.test(target.target_id) && typeof target.target_row_sha256 === "string" && HASH.test(target.target_row_sha256) ? [{ table: target.target_table, id: target.target_id, rowSha256: target.target_row_sha256 }] : []);
      if (linked.length !== detailItem.targets.length) { visible = false; continue; }
      if (!linked.length) continue;
      if (detail.state !== "applied") { visible = false; continue; }
      try {
        const verified = await buildProspectEnrichmentVerification({ packageId: detail.packageId, payloadSha256: detail.payloadSha256, visibilityScope: "canonical", client });
        const report = (verified.report.items as Record<string, unknown>[]).find((item) => item.itemId === stored.id);
        const actual = Array.isArray(report?.targets) ? report!.targets as Record<string, unknown>[] : [];
        if (report?.visibleInFirm !== true || !same(actual.map((target) => [target.targetTable, target.targetId, target.retrievedRowSha256]).sort(), linked.map((target) => [target.table, target.id, target.rowSha256]).sort())) { visible = false; continue; }
        targets.push(...linked);
      } catch { unverifiable = true; }
    }
  }
  const unique = [...new Map(targets.map((target) => [target.table + ":" + target.id, target])).values()].sort((a, b) => a.table.localeCompare(b.table) || a.id.localeCompare(b.id));
  const itemKinds = [...kinds];
  return { targets: unique, primary: itemKinds.length === 1 ? choosePrimary(itemKinds[0], unique) : null, researchKeys: [...researchKeys], kinds: itemKinds, visible: unverifiable ? null : visible ? true : false, parentClientId };
}

async function buildSnapshot(input: ComparisonRequest, rawRequest: unknown, adminRunId: string, client: Db): Promise<{ snapshot: ComparisonExportInput; readSetSha256: string; fence: ComparisonFenceBaseline }> {
  const actor = prospectEnrichmentAgentActor();
  const cache = new Map<string, Awaited<ReturnType<typeof readPackageDetail>>>(), envelopes = input.packages.map((item) => item.envelope);
  const expectedByPackage = new Map(input.manifest.entries.flatMap((entry) => typeof entry.clientPackageId === "string" ? [[entry.clientPackageId, entry] as const] : []));
  if (expectedByPackage.size !== input.manifest.expectedPackageCount || envelopes.length !== expectedByPackage.size) fail("The frozen run package inventory is inconsistent.", 503);
  const runRows = databaseRows(await client.from("prospect_enrichment_packages").select("id,run_id,client_package_id,submitted_by,research_key,payload,payload_sha256,state,firm_id,raw_body_sha256,review_json,review_sha256,expected_revision_sha256,review_expires_at,apply_receipt").eq("run_id", adminRunId).limit(input.manifest.expectedPackageCount + 1));
  if (runRows.length > input.manifest.expectedPackageCount) fail("The finalized run has unexpected staged packages.", 503);
  const packageByClientId = new Map<string, Record<string, unknown>>();
  for (const row of runRows) {
    const clientPackageId = typeof row.client_package_id === "string" ? row.client_package_id : "";
    const entry = expectedByPackage.get(clientPackageId), parsed = parseProspectEnrichmentEnvelope(row.payload);
    if (row.run_id !== adminRunId || row.submitted_by !== actor || !entry || packageByClientId.has(clientPackageId) ||
      !parsed.ok || parsed.envelope.runId !== input.manifest.runId || parsed.envelope.sourceSystem !== input.manifest.sourceSystem ||
      parsed.envelope.sourceName !== input.manifest.sourceName || parsed.envelope.packageId !== clientPackageId ||
      parsed.envelope.subject.researchKey !== entry.researchKey || row.research_key !== entry.researchKey ||
      row.payload_sha256 !== entry.expectedPayloadSha256 || hash(parsed.envelope) !== entry.expectedPayloadSha256) {
      fail("A staged package does not match the exact registered run entry.", 503);
    }
    packageByClientId.set(clientPackageId, row);
  }
  const requestedIds = [...expectedByPackage.keys()];
  const actorScopedRows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < requestedIds.length; offset += 100) {
    actorScopedRows.push(...databaseRows(await client.from("prospect_enrichment_packages").select("id,run_id,client_package_id,submitted_by,research_key,payload_sha256,state").eq("submitted_by", actor).in("client_package_id", requestedIds.slice(offset, offset + 100)).limit(101)));
  }
  if (actorScopedRows.length !== packageByClientId.size || actorScopedRows.some((row) => row.run_id !== adminRunId || !packageByClientId.has(String(row.client_package_id)))) fail("A registered package identity collides with a package from another run.", 503);
  const identities = await readIdentity(envelopes, client), identityByKey = new Map(identities.map((item) => [item.researchKey, item]));
  const packages: ComparisonExportInput["packages"] = [], expectedEntries = new Map(input.manifest.entries.flatMap((entry) => typeof entry.clientPackageId === "string" ? [[entry.clientPackageId, entry] as const] : []));
  for (const item of input.packages) {
    const row = packageByClientId.get(item.envelope.packageId), entry = expectedEntries.get(item.envelope.packageId);
    if (!entry || entry.expectedPayloadSha256 !== item.payloadSha256 || entry.researchKey !== item.envelope.subject.researchKey) fail("A comparison package differs from its frozen run entry.", 422);
    if (!row) { packages.push({ clientPackageId: item.envelope.packageId, payloadSha256: item.payloadSha256, state: "missing", serverPackageId: null, visible: null }); continue; }
    let visible: boolean | null = null;
    let detail: Awaited<ReturnType<typeof readPackageDetail>>;
    try {
      detail = await readPackageDetail({ packageId: String(row.id), client });
    } catch { packages.push({ clientPackageId: String(row.client_package_id), payloadSha256: String(row.payload_sha256), state: String(row.state), serverPackageId: String(row.id), visible: null }); continue; }
    cache.set(String(row.id), detail);
    if (!matchesPackageReadBack(row, detail, item.envelope.packageId)) fail("The stored package read-back failed its integrity check.", 503);
    try {
      if (detail.state !== "applied") visible = true;
      else {
        const verification = await buildProspectEnrichmentVerification({ packageId: detail.packageId, payloadSha256: detail.payloadSha256, visibilityScope: "canonical", client });
        visible = verification.report.items.every((entry) => entry.visibleInPackage === true && (entry.disposition === "retain_only" ? entry.visibleInFirm === null : entry.visibleInFirm === true));
      }
    } catch { visible = null; }
    packages.push({ clientPackageId: String(row.client_package_id), payloadSha256: String(row.payload_sha256), state: String(row.state), serverPackageId: String(row.id), visible });
  }
  const expected = input.packages.flatMap((pkg) => buildProspectEnrichmentClientItems(pkg.envelope).map((lineage) => ({ pkg, lineage }))), keys = [...new Set(expected.map((item) => item.lineage.sourceEventKey))];
  const events: ComparisonExportInput["events"] = [], eventRows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < keys.length; offset += 100) eventRows.push(...databaseRows(await client.from("prospect_enrichment_source_events").select("id,source_system,source_event_key,semantic_sha256").eq("source_system", input.manifest.sourceSystem).in("source_event_key", keys.slice(offset, offset + 100)).limit(101)));
  eventRows.sort((a, b) => String(a.source_event_key).localeCompare(String(b.source_event_key)));
  const eventReadSet: unknown[] = [];
  for (const row of eventRows) {
    const expectedItems = expected.filter((item) => item.lineage.sourceEventKey === row.source_event_key);
    if (!expectedItems.length) continue;
    const semantic = new Set(expectedItems.map((item) => item.lineage.semanticSha256)), research = new Set(expectedItems.map((item) => item.pkg.envelope.subject.researchKey));
    if (semantic.size !== 1 || research.size !== 1) fail("A source event is ambiguous in the frozen request.");
    const stored = await eventEvidence(String(row.id), String(row.source_system), client, cache, eventReadSet);
    const researchKey = stored.researchKeys.length === 1 ? stored.researchKeys[0] : expectedItems[0].pkg.envelope.subject.researchKey;
    if (stored.researchKeys.length > 1 || researchKey !== expectedItems[0].pkg.envelope.subject.researchKey) fail("An existing event is linked to a conflicting firm identity.", 503);
    const mismatch = String(row.semantic_sha256) !== expectedItems[0].lineage.semanticSha256;
    const event: ComparisonExportInput["events"][number] = {
      sourceEventKey: String(row.source_event_key), semanticSha256: String(row.semantic_sha256), researchKey,
      targets: mismatch ? [] : stored.targets, primaryTarget: mismatch ? null : stored.primary, visible: mismatch ? false : stored.visible,
      ...(stored.parentClientId ? { parentAssessmentClientId: stored.parentClientId } : {}),
    };
    const identity = identityByKey.get(researchKey), parent = event.primaryTarget;
    if (identity && parent?.table === "gta_prospect_qualification_assessments" && event.visible === true) {
      for (const candidate of expectedItems.filter((item) => item.pkg.envelope.subject.researchKey === researchKey && item.pkg.envelope.assessment)) {
        for (const claim of candidate.pkg.legacyAssessmentProjectionClaims) {
          const envelope = { ...candidate.pkg.envelope, subject: { ...candidate.pkg.envelope.subject, identityState: "resolved" as const, databaseFirmId: identity.databaseFirmId, stableFirmId: identity.stableFirmId, sourceRecordKey: identity.sourceRecordKey, canonicalDomain: identity.canonicalDomain } };
          const proof = await readProspectLegacyAssessmentProjectionProof({ envelope, claim, parentAssessmentTarget: parent as typeof parent & { table: "gta_prospect_qualification_assessments" }, firmId: identity.databaseFirmId, client });
          if (proof) (event.legacyAssessmentProjections ??= []).push(proof);
        }
      }
    }
    events.push(event);
  }
  const sortedPackages = packages.sort((a, b) => a.clientPackageId.localeCompare(b.clientPackageId));
  const sortedEvents = events.sort((a, b) => a.sourceEventKey.localeCompare(b.sourceEventKey));
  const sortedIdentities = identities.sort((a, b) => a.researchKey.localeCompare(b.researchKey));
  const snapshot: ComparisonExportInput = { schemaVersion: "prospect-enrichment-comparison/v1", projectId: "ssxryjxifwiivghglqer", capturedAt: new Date().toISOString(), provenance: { reader: "admin-prospect-enrichment-comparison/v1", sourceArtifactSha256: hash(rawRequest), operatorAuthenticated: true }, identities: sortedIdentities, packages: sortedPackages, events: sortedEvents };
  const cachedPackages = [...cache.values()].map((detail) => ({ packageId: detail.packageId, clientPackageId: detail.clientPackageId, payloadSha256: detail.payloadSha256, state: detail.state, firmId: detail.firmId, rawBodySha256: detail.rawBodySha256, itemReadBack: detail.items.map((item) => ({ itemId: item.itemId, hash: item.hash, targets: item.targets, firmRevision: isRecord(item.currentValue) ? item.currentValue.firmRevision : null })) })).sort((a, b) => a.packageId.localeCompare(b.packageId));
  const runPackageReadSet = runRows.map((row) => ({ id: row.id, runId: row.run_id, actor: row.submitted_by, clientPackageId: row.client_package_id, researchKey: row.research_key, payloadSha256: row.payload_sha256, state: row.state, firmId: row.firm_id, rawBodySha256: row.raw_body_sha256, reviewJson: row.review_json, reviewSha256: row.review_sha256, expectedRevisionSha256: row.expected_revision_sha256, reviewExpiresAt: row.review_expires_at, applyReceipt: row.apply_receipt })).sort((a, b) => String(a.clientPackageId).localeCompare(String(b.clientPackageId)));
  const eventPresence = keys.map((key) => { const rows = eventRows.filter((row) => row.source_event_key === key); return { key, rows: rows.map((row) => ({ id: row.id, sourceSystem: row.source_system, semanticSha256: row.semantic_sha256 })) }; });
  const actorPackageReadSet = actorScopedRows.map((row) => ({ id: row.id, runId: row.run_id, clientPackageId: row.client_package_id, researchKey: row.research_key, payloadSha256: row.payload_sha256, state: row.state })).sort((a, b) => String(a.clientPackageId).localeCompare(String(b.clientPackageId)));
  const readSetSha256 = hash({ adminRunId, sourceRunKey: input.manifest.runId, manifestSha256: input.manifest.manifestSha256, runPackageReadSet, actorScopedRows: actorPackageReadSet, eventPresence, eventReadSet, identities: sortedIdentities, cachedPackages });
  const fence: ComparisonFenceBaseline = { adminRunId, actor, sourceSystem: input.manifest.sourceSystem,
    expectedPackageCount: input.manifest.expectedPackageCount, requestedPackageIds: [...expectedByPackage.keys()],
    expectedEventKeys: keys, runPackages: runPackageReadSet, actorPackages: actorPackageReadSet, eventPresence,
    eventItems: eventReadSet as { eventId: string; items: Record<string, unknown>[] }[], packageDetails: [...cache.values()],
    identities: sortedIdentities, snapshot };
  return { snapshot, readSetSha256, fence };
}

export async function POST(request: NextRequest) {
  const auth = await requireProspectEnrichmentOperator(request, true);
  if (!auth.ok) return auth.response;
  if (auth.operator.session.role !== "operator") return prospectEnrichmentJson({ error: "An operator session is required." }, 403);
  const body = await readBoundedJson(request, MAX_REQUEST_BYTES);
  if (!body.ok) return prospectEnrichmentJson({ error: body.error }, body.status);
  try {
    const parsed = parseRequest(body.value);
    const binding = await requireRegisteredRunManifest({ manifest: parsed.manifest, actor: prospectEnrichmentAgentActor(), client: supabaseAdmin });
    const keyId = process.env.PROSPECT_ENRICHMENT_COMPARISON_SIGNING_KEY_ID;
    const privateKeyPem = process.env.PROSPECT_ENRICHMENT_COMPARISON_SIGNING_PRIVATE_KEY_PEM;
    if (!keyId || !privateKeyPem) throw new ReadApiError("Server comparison signing is not configured.", 503);
    const initial = await buildSnapshot(parsed, body.value, binding.adminRunId, supabaseAdmin);
    const finalBinding = await requireRegisteredRunManifest({ manifest: parsed.manifest, actor: prospectEnrichmentAgentActor(), client: supabaseAdmin });
    if (finalBinding.adminRunId !== binding.adminRunId) throw new ReadApiError("The registered run changed during comparison. Retry the read.", 503);
    const final = await buildSnapshot(parsed, body.value, binding.adminRunId, supabaseAdmin);
    if (initial.readSetSha256 !== final.readSetSha256 || comparisonContentFingerprint(initial.snapshot as unknown as Record<string, unknown>, hash) !== comparisonContentFingerprint(final.snapshot as unknown as Record<string, unknown>, hash)) throw new ReadApiError("Admin research changed during comparison. Retry the read for a stable snapshot.", 503);
    await verifyComparisonFinalFence({ baseline: final.fence, client: supabaseAdmin, envelopes: parsed.packages.map((item) => item.envelope), readIdentity });
    const fencedSnapshot = { ...final.snapshot, capturedAt: new Date().toISOString() };
    return prospectEnrichmentJson(serializeComparisonExport(fencedSnapshot, new Date().toISOString(), { keyId, privateKeyPem }).snapshot);
  }
  catch (cause) {
    if (cause instanceof ReadApiError) return prospectEnrichmentJson({ error: cause.message, ...(process.env.PROSPECT_ENRICHMENT_TEST_DIAGNOSTICS === "1" && cause.diagnostic ? { diagnostic: cause.diagnostic } : {}) }, cause.status);
    console.error("[prospect-enrichment] comparison export failed", { error: "read_or_schema" });
    return prospectEnrichmentJson({ error: "A complete comparison could not be verified." }, 503);
  }
}
