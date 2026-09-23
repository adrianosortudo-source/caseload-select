import { buildProspectEnrichmentClientItems, parseProspectEnrichmentEnvelope, type ProspectEnrichmentEnvelope } from "../../src/lib/prospect-enrichment-contract";
import { CompiledPackage } from "./compiler";
import { Issue, canonicalJson, object, ordinal, protocolHash } from "./model";
import { isCriteriaSelector, validateLegacyAssessmentProjectionClaims } from "./legacy-projections";
import { deriveLegacyAssessmentProjection } from "./legacy-projection-mapper";
import { verifyComparisonSignature, type ComparisonSignature, type ComparisonTrust } from "./comparison-signature";

export type Target = { table: string; id: string; rowSha256: string };
export type LegacyAssessmentProjectionProof = {
  observationSourceEventKey:string; observationSemanticSha256:string; parentAssessmentClientId:string;
  parentAssessmentTarget:Target; databaseFirmId:string; criteriaSelector:string; selectedValueSha256:string;
};
export function validLegacyAssessmentProjectionProof(value: unknown): value is LegacyAssessmentProjectionProof {
  if (!object(value) || Object.keys(value).length !== 7 || !["observationSourceEventKey","observationSemanticSha256","parentAssessmentClientId","parentAssessmentTarget","databaseFirmId","criteriaSelector","selectedValueSha256"].every(k=>Object.hasOwn(value,k))) return false;
  const target=value.parentAssessmentTarget, hash=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
  return typeof value.observationSourceEventKey==="string" && /^observation:[a-f0-9]{64}$/.test(value.observationSourceEventKey) && hash(value.observationSemanticSha256) && typeof value.parentAssessmentClientId==="string" && value.parentAssessmentClientId.length>0 && object(target) && Object.keys(target).length===3 && target.table==="gta_prospect_qualification_assessments" && typeof target.id==="string" && target.id.length>0 && hash(target.rowSha256) && typeof value.databaseFirmId==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.databaseFirmId) && isCriteriaSelector(value.criteriaSelector) && hash(value.selectedValueSha256);
}
export type ComparisonSnapshot = {
  schemaVersion: "prospect-enrichment-comparison/v1";
  projectId: "ssxryjxifwiivghglqer";
  capturedAt: string;
  provenance: { reader: string; sourceArtifactSha256: string; operatorAuthenticated: true };
  identities: { researchKey: string; databaseFirmId: string; stableFirmId: string | null; sourceRecordKey: string; canonicalDomain: string | null }[];
  packages: { clientPackageId: string; payloadSha256: string; state: string; serverPackageId: string | null; visible: boolean | null }[];
  events: { sourceEventKey: string; semanticSha256: string; researchKey: string; targets: Target[]; primaryTarget: Target | null; visible: boolean | null; parentAssessmentClientId?: string; legacyAssessmentProjections?: LegacyAssessmentProjectionProof[] }[];
  currentAssessments?: { researchKey: string; clientAssessmentId: string }[];
  snapshotSha256: string;
  signature: ComparisonSignature;
};
export type ReconciledAction = { clientPackageId: string; researchKey: string; action: "link_existing" | "reuse_existing_draft" | "verify_existing" | "idempotency_conflict" | "presentation_gap" | "stage_new" | "hold_identity" | "hold_schema" | "hold_terminal" | "receipt_unverified"; reason: string; envelope: ProspectEnrichmentEnvelope; linked: { itemId: string; targets: Target[] }[]; retained: { itemId: string; reason: string }[] };

export function items(envelope: ProspectEnrichmentEnvelope) {
  const values = [
    ...envelope.sources.map(value => ({ originalId: value.sourceId, value })),
    ...envelope.observations.map(value => ({ originalId: value.observationId, value })),
    ...(envelope.assessment ? [{ originalId: envelope.assessment.assessmentId, value: envelope.assessment }] : []),
  ];
  const lineage = buildProspectEnrichmentClientItems(envelope);
  if (lineage.length !== values.length) throw Error("shared_client_lineage_count_mismatch");
  return lineage.map((item, index) => ({ ...values[index], kind: item.itemKind, id: item.clientItemId, sourceEventKey: item.sourceEventKey, semanticSha256: item.semanticSha256 }));
}

export function validateComparisonSnapshot(snapshot: ComparisonSnapshot, now = new Date().toISOString(), trust?:ComparisonTrust|null): Issue[] {
  if (!object(snapshot) || !Array.isArray(snapshot.events) || !Array.isArray(snapshot.packages) || !Array.isArray(snapshot.identities)) return [{ code: "comparison_schema_invalid", path: "", reason: "Comparison arrays are required" }];
  const { snapshotSha256, signature: _signature, ...content } = snapshot;
  void _signature;
  const issues: Issue[] = [];
  if (protocolHash(content) !== snapshotSha256) issues.push({ code: "comparison_hash_mismatch", path: "snapshotSha256", reason: "Frozen operator comparison was modified" });
  if (snapshot.schemaVersion !== "prospect-enrichment-comparison/v1" || snapshot.projectId !== "ssxryjxifwiivghglqer" || snapshot.provenance?.operatorAuthenticated !== true || !snapshot.provenance?.reader || !/^[a-f0-9]{64}$/.test(snapshot.provenance?.sourceArtifactSha256 ?? "")) issues.push({ code: "comparison_provenance_missing", path: "provenance", reason: "Comparison must come from the authenticated supported operator read path for the fixed project" });
  for (const [index, event] of snapshot.events.entries()) {
    const target = event?.primaryTarget;
    if (!object(event) || !Array.isArray(event.targets) || !Object.hasOwn(event, "primaryTarget") || !(target === null || (object(target) && typeof target.table === "string" && typeof target.id === "string" && typeof target.rowSha256 === "string" && /^[a-f0-9]{64}$/.test(target.rowSha256) && Object.keys(target).length === 3 && event.targets.filter(t => canonicalJson(t) === canonicalJson(target)).length === 1))) issues.push({ code: "comparison_primary_target_invalid", path: "events/" + index + "/primaryTarget", reason: "Explicit primaryTarget must be null or equal one exact accepted target; array order is not authority" });
    if (object(event) && Object.hasOwn(event, "legacyAssessmentProjections") && (!Array.isArray(event.legacyAssessmentProjections) || event.legacyAssessmentProjections.some(proof => !validLegacyAssessmentProjectionProof(proof) || canonicalJson(proof.parentAssessmentTarget)!==canonicalJson(event.primaryTarget) || event.sourceEventKey!=="assessment:"+protocolHash([event.researchKey,proof.parentAssessmentClientId])))) issues.push({code:"comparison_legacy_projection_invalid",path:"events/"+index+"/legacyAssessmentProjections",reason:"Legacy projection proofs require an exact parent event, target, safe criteria selector and complete hashes."});
  }
  const signatureError=verifyComparisonSignature(snapshot,trust);
  if(signatureError) issues.push({code:signatureError,path:"signature",reason:"A valid server Ed25519 signature under an explicitly trusted public key is required."});
  const age = Date.parse(now) - Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(age) || age < 0 || age > 15 * 60_000) issues.push({ code: "comparison_stale", path: "capturedAt", reason: "Re-export the operator comparison immediately before delivery; snapshot maximum age is 15 minutes" });
  return issues;
}

export function researchClaimsAccepted(content: unknown): boolean {
  if (!object(content)) return false;
  const candidate = object(content.candidate) ? content.candidate : content;
  const result = object(content.result) ? content.result : candidate;
  return !!(result.receiptId || result.persistedSections || result.readBackAt || (object(content.candidateContext) && Array.isArray(content.candidateContext.receipts) && content.candidateContext.receipts.length));
}

/** Reconciliation consumes a fresh exported operator read, never a local persisted=true claim. */
export function reconcilePackage(compiled: CompiledPackage, snapshot: ComparisonSnapshot | null, options: { now?: string; sourceClaimsAccepted?: boolean; comparisonTrust?:ComparisonTrust|null } = {}): ReconciledAction {
  const e = compiled.envelope;
  const result = (action: ReconciledAction["action"], reason: string, envelope = e, linked: ReconciledAction["linked"] = [], retained: ReconciledAction["retained"] = []): ReconciledAction => ({ clientPackageId: e.packageId, researchKey: e.subject.researchKey, action, reason, envelope: ["receipt_unverified","hold_terminal","hold_schema"].includes(action) ? { ...envelope, mode: "propose", observations: envelope.observations.map(o => ({ ...o, existingRecord: null })), assessment: envelope.assessment ? { ...envelope.assessment, existingRecord: null } : null } : envelope, linked: ["receipt_unverified","hold_terminal","hold_schema"].includes(action) ? [] : linked, retained });
  if (compiled.issues.some(i => i.code === "hold_schema" || i.code === "source_event_conflict")) return result("hold_schema", "Resolve the exact compiler error before delivery");
  if (!snapshot || validateComparisonSnapshot(snapshot, options.now, options.comparisonTrust).length) return result("receipt_unverified", "Fresh authenticated comparison evidence is missing or invalid; no submission selected");
  if (validateLegacyAssessmentProjectionClaims(e, compiled.legacyAssessmentProjectionClaims).length) return result("receipt_unverified", "Compiler projection metadata does not match exact original criteria evidence");
  const evidenceItems = items(e);
  const observed = snapshot.events.filter(event => evidenceItems.some(item => item.sourceEventKey === event.sourceEventKey));
  if (observed.some(event => { const item = evidenceItems.find(i => i.sourceEventKey === event.sourceEventKey)!; return event.semanticSha256 !== item.semanticSha256 || event.researchKey !== e.subject.researchKey; })) return result("idempotency_conflict", "A source event ID has conflicting semantic content or identity");
  if (observed.some(event => event.visible === false)) return result("receipt_unverified", "Accepted evidence is known absent from the complete Admin read; repair its presentation before linkage");
  if (observed.some(event => event.visible !== true)) return result("receipt_unverified", "Accepted evidence visibility is unknown or its Admin read failed; no linkage is verified");
  const same = snapshot.packages.filter(p => p.clientPackageId === e.packageId);
  if (same.some(p => p.payloadSha256 !== compiled.payloadSha256)) return result("idempotency_conflict", "Existing client package ID has a different protocol payload hash");
  if (same.length > 1) return result("receipt_unverified","Comparison repeats a package identity; obtain one authoritative current state");
  if (same.length) {
    switch(same[0].state){
      case "missing":
        return same[0].serverPackageId === null && same[0].visible === null ? result("stage_new", "The signed Admin read-back confirms this exact run has no saved package") : result("hold_schema", "The Admin missing-package read-back is malformed");
      case "received": case "identity_hold": case "evidence_hold": case "ready_for_review":
        return result("reuse_existing_draft","Reuse the existing resumable package in state "+same[0].state);
      case "applied":
        return same[0].visible===true ? result("verify_existing","Verify the applied package and its visible receipt") : same[0].visible===false ? result("presentation_gap","Applied package is absent from the complete Admin read") : result("receipt_unverified","Applied package visibility is unknown; obtain a successful authenticated Admin read");
      case "rejected": case "superseded":
        return result("hold_terminal","Existing package is "+same[0].state+"; it cannot resume or authorize a new import");
      default:
        return result("hold_schema","Unknown persisted package state; do not reuse or submit until the protocol recognizes it");
    }
  }
  const identities = snapshot.identities.filter(i => i.researchKey === e.subject.researchKey);
  if (identities.length !== 1 || e.subject.identityState === "conflict") return result("hold_identity", "Preserve the complete package in staging; a single confirmed identity mapping is unavailable");
  const identity = identities[0];
  if ((e.subject.databaseFirmId && e.subject.databaseFirmId !== identity.databaseFirmId) || (e.subject.stableFirmId && e.subject.stableFirmId !== identity.stableFirmId) || (e.subject.sourceRecordKey && e.subject.sourceRecordKey !== identity.sourceRecordKey)) return result("hold_identity", "Fresh registered identity conflicts with the package claim");
  const resolved = { ...e, subject: { ...e.subject, ...identity, identityState: "resolved" as const } };
  const linked: ReconciledAction["linked"] = [], retained: ReconciledAction["retained"] = [];
  const clientItems = items(e);
  const observationClientIds = new Map(clientItems.filter(item => item.kind === "observation").map(item => [item.originalId, item.id]));
  const assignments = new Map<string, Target>();
  for (const item of clientItems) {
    const matches = snapshot.events.filter(event => event.sourceEventKey === item.sourceEventKey);
    if (matches.some(event => event.semanticSha256 !== item.semanticSha256 || event.researchKey !== e.subject.researchKey)) return result("idempotency_conflict", "A source event ID has conflicting semantic content or identity");
    const accepted = matches.filter(event => event.targets.length > 0);
    if (accepted.some(event => event.visible === false)) return result("receipt_unverified", "Accepted evidence is known absent from the complete Admin read; repair its presentation before linkage");
    if (accepted.some(event => event.visible !== true)) return result("receipt_unverified", "Accepted evidence visibility is unknown or its Admin read failed; no linkage is verified");
    const targets = accepted.flatMap(event => event.targets);
    if (targets.length) {
      if (accepted.some(event => event.primaryTarget === null)) return result("receipt_unverified", "Accepted evidence has no proven primary target; retain auxiliary targets without guessing");
      const primary = accepted[0].primaryTarget!;
      if (accepted.some(event => canonicalJson(event.primaryTarget) !== canonicalJson(primary))) return result("receipt_unverified", "Accepted evidence has conflicting primary targets");
      if (item.kind !== "source" && (["prospect_source_captures", "prospect_source_record_map", "gta_prospect_firms", "gta_prospect_stable_identity_registry"].includes(primary.table) || primary.table.endsWith("_audit"))) return result("receipt_unverified", "An auxiliary target cannot stand in for the primary evidence row");
      linked.push({ itemId: item.id, targets }); assignments.set(item.id, primary);
    }
  }
  const parentId = clientItems.find(item => item.kind === "assessment")?.id;
  const parentLinked = parentId && assignments.get(parentId)?.table === "gta_prospect_qualification_assessments";
  for (const item of items(e)) if (!assignments.has(item.id)) {
    const retract = "evidenceState" in item.value && item.value.evidenceState === "retracted";
    if (retract) retained.push({ itemId: item.id, reason: "retracted_legacy_evidence_preserved_for_history" });
    else if (parentLinked && item.kind === "observation") {
      const claim = compiled.legacyAssessmentProjectionClaims?.find(c => c.observationId===item.originalId);
      const derived = claim ? deriveLegacyAssessmentProjection(e,claim,e.assessment?.legacyCriteria) : null;
      const proof = derived ? snapshot.events.filter(event => event.visible===true && event.researchKey===e.subject.researchKey && event.sourceEventKey===clientItems.find(i=>i.id===parentId)?.sourceEventKey && canonicalJson(event.primaryTarget)===canonicalJson(assignments.get(parentId!))).flatMap(event=>event.legacyAssessmentProjections??[]).filter(proof =>
        proof.observationSourceEventKey===derived.observationSourceEventKey && proof.observationSemanticSha256===derived.observationSemanticSha256 && proof.parentAssessmentClientId===parentId && proof.parentAssessmentClientId===derived.parentAssessmentClientId && proof.databaseFirmId===identity.databaseFirmId && canonicalJson(proof.parentAssessmentTarget)===canonicalJson(assignments.get(parentId!)) && proof.criteriaSelector===derived.criteriaSelector && proof.selectedValueSha256===derived.selectedValueSha256) : [];
      if (proof.length===1) retained.push({itemId:item.id,reason:"already_preserved_in_linked_legacy_assessment"});
    }
  }
  if (options.sourceClaimsAccepted && !linked.length) return result("receipt_unverified", "Source claims persistence but no exact accepted item lineage was verified");
  if (linked.length) {
    // Partial overlap is retained for explicit review; it is never silently converted into new typed evidence.
    const unaccounted = clientItems.filter(i => i.kind !== "source" && !assignments.has(i.id) && !retained.some(r => r.itemId === i.id));
    if (unaccounted.length) return result("receipt_unverified", "Some findings match accepted history and others require explicit delta reconciliation", resolved, linked, retained);
    return result("link_existing", "Link accepted rows and retain derived/retracted evidence without inserting duplicates", { ...resolved, mode: "link_existing", observations: resolved.observations.map(o => ({ ...o, existingRecord: assignments.get(observationClientIds.get(o.observationId)!) ?? null })), assessment: resolved.assessment ? { ...resolved.assessment, existingRecord: assignments.get(parentId!) ?? null } : null }, linked, retained);
  }
  return result("stage_new", "No exact accepted or staged package/event exists in the fresh operator comparison", resolved, linked, retained);
}

export function selectPilot(packages: CompiledPackage[], currentAssessments: { researchKey: string; clientAssessmentId: string }[] = []) {
  const byCandidate = new Map<string, CompiledPackage[]>();
  packages.forEach(p => byCandidate.set(p.envelope.subject.researchKey, [...(byCandidate.get(p.envelope.subject.researchKey) ?? []), p]));
  const partitions = new Map<string, string[]>(["Identity", "Qualified", "Held", "Rejected", "Incomplete"].map(k => [k, []]));
  const issues: Issue[] = [];
  for (const [key, versions] of byCandidate) {
    const identity = versions.some(p => p.envelope.subject.identityState !== "resolved");
    const current = currentAssessments.filter(a => a.researchKey === key);
    if (current.length > 1) { issues.push({ code: "pilot_assessment_conflict", path: key, reason: "Operator comparison declares multiple current assessments" }); continue; }
    const selectedVersions = current.length ? versions.filter(p => items(p.envelope).find(item => item.kind === "assessment")?.id === current[0].clientAssessmentId) : versions.filter(p => p.envelope.assessment);
    if (current.length && !selectedVersions.length) { issues.push({ code: "pilot_assessment_missing", path: key, reason: "Current accepted assessment is not included in the frozen candidate history" }); continue; }
    const categories = [...new Set(selectedVersions.map(p => p.displayCategory))];
    // A different historical disposition is not a deterministic current decision.
    if (!identity && categories.length > 1) { issues.push({ code: "pilot_assessment_conflict", path: key, reason: "Select the current accepted assessment through receipt reconciliation, not filename order" }); continue; }
    partitions.get(identity ? "Identity" : categories[0] ?? "Incomplete")!.push(key);
  }
  const selected: { researchKey: string; partition: string; packageIds: string[]; payloadHashes: string[] }[] = [];
  for (const [partition, candidates] of partitions) {
    candidates.sort(ordinal);
    if (candidates.length < 2) issues.push({ code: "pilot_partition_shortfall", path: partition, reason: canonicalJson({ available: candidates, required: 2 }) });
    for (const researchKey of candidates.slice(0, 2)) selected.push({ researchKey, partition, packageIds: byCandidate.get(researchKey)!.map(p => p.envelope.packageId).sort(ordinal), payloadHashes: byCandidate.get(researchKey)!.map(p => p.payloadSha256).sort(ordinal) });
  }
  return { schemaVersion: "prospect-enrichment-pilot/v1", selected, issues, ready: selected.length === 10 && issues.length === 0 };
}

/** Freeze reconciled link/identity decisions before the run manifest is approved or registered. */
export function bindReconciledPackages(packages: CompiledPackage[], actions: ReconciledAction[]): CompiledPackage[] {
  if (actions.length !== packages.length || new Set(actions.map(a => a.clientPackageId)).size !== actions.length) throw Error("reconciled_package_coverage_mismatch");
  return packages.map(p => {
    const action = actions.find(a => a.clientPackageId === p.envelope.packageId);
    if (!action) throw Error("reconciled_package_missing");
    const parsed = parseProspectEnrichmentEnvelope(action.envelope);
    if (!parsed.ok) throw Error("reconciled_envelope_invalid");
    const envelope = parsed.envelope, original = p.envelope;
    const immutable = ["schemaVersion", "packageId", "runId", "sourceSystem", "sourceName", "generatedAt"] as const;
    const lineage = (e: ProspectEnrichmentEnvelope) => items(e).map(i => [i.kind, i.id, i.semanticSha256]);
    if (immutable.some(k => envelope[k] !== original[k]) || envelope.subject.researchKey !== original.subject.researchKey || protocolHash(envelope.originalResearch) !== protocolHash(original.originalResearch) || protocolHash(lineage(envelope)) !== protocolHash(lineage(original))) throw Error("reconciliation_changed_original_evidence");
    return { ...p, envelope, payloadSha256: protocolHash(envelope), state: p.state === "evidence_hold" ? "evidence_hold" : envelope.subject.identityState === "resolved" ? "ready_for_review" : "identity_hold" };
  });
}

export function assertFreshComparison(snapshot: unknown, now = new Date().toISOString(), trust?:ComparisonTrust|null): asserts snapshot is ComparisonSnapshot {
  if (!object(snapshot) || !Array.isArray(snapshot.identities) || !Array.isArray(snapshot.packages) || !Array.isArray(snapshot.events)) throw Error("comparison_schema_invalid");
  const issues = validateComparisonSnapshot(snapshot as ComparisonSnapshot, now, trust);
  if (issues.length) throw Error(issues[0].code);
}
