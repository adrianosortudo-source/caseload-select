import { parseProspectEnrichmentEnvelope, type ProspectEnrichmentEnvelope, type JsonValue } from "../../src/lib/prospect-enrichment-contract";
import { ADAPTER_VERSION, SOURCE_NAME, SOURCE_SYSTEM, type Issue, canonicalJson, displayCategory, eventId, leafPointers, list, object, ordinal, pointerPart, protocolHash, publicUrl, recordedDate, selectionDisposition, sha256, strings, text, unique } from "./model";
import type { CandidateInput, SourceManifest } from "./inventory";
import { projectionClaim, type LegacyAssessmentProjectionClaim } from "./legacy-projections";

// Legacy source objects are heterogeneous. Every emitted envelope must pass the shared strict validator.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyItem = Record<string, any>;
export type CompiledPackage = { envelope: ProspectEnrichmentEnvelope; payloadSha256: string; state: "ready_for_review" | "identity_hold" | "evidence_hold"; displayCategory: string; originalStatus: unknown; issues: Issue[]; legacyAssessmentProjectionClaims?: LegacyAssessmentProjectionClaim[] };
export type CompileResult = { researchKey: string; packages: CompiledPackage[]; issues: Issue[]; retainedOriginal: unknown };
const gate = (v: unknown) => ["pass", "fail", "unknown"].includes(String(v)) ? v : "unknown";
const enumeration = (v: unknown, choices: string[], fallback: string | null = "unknown"): string | null => choices.includes(String(v)) ? String(v) : fallback;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stableId = /^FIRM-[0-9A-HJKMNP-TV-Z]{26}$/;
const sourceKey = /^[a-z0-9][a-z0-9-]{1,159}$/;
const clean = (v: unknown): JsonValue => JSON.parse(JSON.stringify(v)) as JsonValue;

export function immutableResearchKey(input: CandidateInput): string {
  const root = input.original, r = object(root.record) ? root.record : root;
  const system = text(root.sourceSystem) ?? text(input.parentMetadata.sourceSystem) ?? input.artifact.sourceRoot;
  for (const value of [root.researchKey, r.researchKey, root.canonicalCandidateId, r.canonicalCandidateId, root.workKey, r.workKey, root.sourceRecordKey, r.sourceRecordKey]) if (text(value)) return String(value);
  const research = object(root.researchKey) ? root.researchKey : object(r.researchKey) ? r.researchKey : null;
  if (research && text(research.localCandidateSourcePath) && text(research.localCandidateKey)) return `legacy:${protocolHash([system, research.localCandidateSourcePath, research.localCandidateKey])}`;
  // A domain or name by itself cannot establish the same candidate across files.
  const claims = Object.fromEntries(["canonicalDomain", "firmName", "canonicalFirmName", "sourceRecordKey", "candidateKey"].filter(k => r[k] != null).map(k => [k, r[k]]));
  if (text(claims.canonicalDomain) && (text(claims.firmName) || text(claims.canonicalFirmName))) return `legacy:${sha256(`${system}\n${canonicalJson(claims)}`)}`;
  return `legacy-archive:${protocolHash([input.artifact.sourceRoot, input.artifact.relativePath, input.artifact.fileSha256, input.pointer])}`;
}

/** Pure compiler: no reads, writes, network, identity creation or truth adjudication. */
export function compileCandidate(input: CandidateInput, manifest: Pick<SourceManifest, "manifestSha256" | "snapshotAt">): CompileResult {
  const original = input.original, r: AnyItem = object(original.record) ? original.record : original;
  const recordPrefix = object(original.record) ? "/record" : "";
  const content = Object.keys(input.parentMetadata).length ? { candidate: original, parentMetadata: input.parentMetadata } : original;
  const prefix = Object.keys(input.parentMetadata).length ? "/candidate" : "";
  const researchKey = immutableResearchKey(input);
  const system = text(original.sourceSystem) ?? text(input.parentMetadata.sourceSystem) ?? input.artifact.sourceRoot;
  const issues: Issue[] = [], covered = new Set<string>(), retainedPointers = new Set<string>();
  const mark = (p: string) => covered.add(`${prefix}${p}`);
  const idClaims = { databaseFirmId: [] as string[], stableFirmId: [] as string[], sourceRecordKey: [] as string[] };
  const assessmentEntries: { raw: AnyItem; pointer: string }[] = [];
  for (const [base, p] of [[original, ""], [r, recordPrefix]] as const) {
    if (base !== original || p === "") {
      list(base.qualificationAssessments).forEach((a, i) => { if (object(a)) assessmentEntries.push({ raw: a, pointer: `${p}/qualificationAssessments/${i}` }); });
    }
  }
  // Same object at the root is visited only once.
  const assessments = unique(assessmentEntries.map(e => e.pointer)).map(p => assessmentEntries.find(e => e.pointer === p)!);
  if (!assessments.length && [original.databaseDecision, original.disposition, original.status, r.qualificationState, r.selectionDisposition].some(v => v !== undefined)) assessments.push({ raw: original, pointer: "" });
  const claimObjects = [original, r, ...assessments.map(a => a.raw), ...assessments.map(a => a.raw.criteria).filter(object)];
  for (const c of claimObjects) {
    const database = c.databaseFirmId, stable = c.stableFirmId ?? c.firmId, key = c.sourceRecordKey;
    if (text(database)) idClaims.databaseFirmId.push(String(database));
    if (text(stable)) { if (uuid.test(String(stable))) idClaims.databaseFirmId.push(String(stable)); else idClaims.stableFirmId.push(String(stable)); }
    if (text(key)) idClaims.sourceRecordKey.push(String(key));
  }
  const invalidIdentity = idClaims.databaseFirmId.some(v => !uuid.test(v)) || idClaims.stableFirmId.some(v => !stableId.test(v)) || idClaims.sourceRecordKey.some(v => !sourceKey.test(v));
  const conflict = invalidIdentity || Object.values(idClaims).some(v => unique(v).length > 1) || r.identityConflict?.state === "confirmed" || r.identityState === "conflict";
  const domainClaim = text(r.canonicalDomain) ?? text(r.domain);
  let domain: string | null = null;
  if (domainClaim) {
    try { const u = new URL(domainClaim.includes("://") ? domainClaim : `https://${domainClaim}`); if (u.port || u.username || u.password || (u.pathname !== "/" && u.pathname !== "")) throw Error(); domain = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, ""); }
    catch { issues.push({ code: "identity_claim_invalid", path: `${recordPrefix}/canonicalDomain`, reason: "Domain claim is not a canonical hostname; retained unchanged in original research." }); }
  }
  const subject = { researchKey, databaseFirmId: !conflict ? idClaims.databaseFirmId.find(v => uuid.test(v)) ?? null : null, stableFirmId: !conflict ? idClaims.stableFirmId.find(v => stableId.test(v)) ?? null : null, sourceRecordKey: !conflict ? idClaims.sourceRecordKey.find(v => sourceKey.test(v)) ?? null : null, canonicalDomain: domain, displayName: text(r.firmName) ?? text(r.canonicalFirmName) ?? text(original.firmName) ?? "Unnamed research candidate", identityState: conflict ? "conflict" : "unresolved" };
  // Only a fresh receipt reconciliation may change unresolved to resolved.
  if (conflict) issues.push({ code: "hold_identity", path: recordPrefix, reason: "Supplied identifiers conflict or fail their declared types; no identifier chosen." });
  const sourceMap = new Map<string, AnyItem>(), sourceAliases = new Map<string, string[]>(), sourcePointers = new Map<string, string[]>();
  function addSource(raw: AnyItem, pointer: string, overrideUrl?: string) {
    const date = recordedDate(raw.observedAt ?? raw.observedOn ?? raw.observed_at ?? raw.checkedAt);
    const url = publicUrl(overrideUrl ?? raw.sourceUrl ?? raw.url);
    const publication = text(raw.publicationLabel) ?? text(raw.publicationDate) ?? text(raw.sourcePublicationLabel);
    const semantic = { url, requestedUrl: publicUrl(raw.requestedUrl), finalUrl: publicUrl(raw.finalUrl), policyState: enumeration(raw.policyState, ["public-source", "policy-blocked", "legacy-unknown"], "legacy-unknown"), publicationLabel: publication, publicationPrecision: publication && /^\d{4}$/.test(publication) ? "year" : publication && /^\d{4}-\d{2}-\d{2}$/.test(publication) ? "exact_date" : "unknown", publisher: text(raw.publisher), observedAt: date.observedAt, observedOn: date.observedOn, retrievedAt: recordedDate(raw.retrievedAt).observedAt, retrievalMethod: text(raw.retrievalMethod) ?? text(raw.method) ?? "legacy-unknown", retrievalOutcome: text(raw.retrievalOutcome) ?? "legacy-unknown", httpStatus: Number.isInteger(raw.httpStatus) ? raw.httpStatus : null, bodySha256: /^[a-f0-9]{64}$/.test(String(raw.bodySha256 ?? raw.captureSha256)) ? raw.bodySha256 ?? raw.captureSha256 : null, excerpt: text(raw.excerpt) ?? text(raw.configurationEvidence), missingProvenanceReason: date.missingProvenanceReason ?? (!url ? "source_url_not_recorded" : null) };
    const sourceId = eventId("src", system, researchKey, "source", semantic, raw.sourceId);
    const previous = sourceMap.get(sourceId);
    if (previous && protocolHash(previous) !== protocolHash({ sourceId, ...semantic })) issues.push({ code: "source_event_conflict", path: pointer, reason: "Original source ID is reused with changed evidence; retained for review." });
    else sourceMap.set(sourceId, { sourceId, ...semantic });
    if (text(raw.sourceId)) sourceAliases.set(raw.sourceId, unique([...(sourceAliases.get(raw.sourceId) ?? []), sourceId]));
    if (url) sourceAliases.set(url, unique([...(sourceAliases.get(url) ?? []), sourceId]));
    sourcePointers.set(pointer, unique([...(sourcePointers.get(pointer) ?? []), sourceId]));
    for (const k of ["sourceUrl", "url", "observedAt", "observedOn", "publicationLabel", "publicationDate", "sourcePublicationLabel", "method", "retrievalMethod", "retrievalOutcome", "httpStatus", "bodySha256", "captureSha256", "excerpt", "configurationEvidence"]) if (k in raw) mark(`${pointer}/${k}`);
    return sourceId;
  }
  function sourceWalk(value: unknown, pointer: string) {
    if (Array.isArray(value)) { value.forEach((v, i) => sourceWalk(v, `${pointer}/${i}`)); return; }
    if (!object(value)) return;
    if (text(value.sourceUrl) || (text(value.url) && ("observedAt" in value || "sourceId" in value)) || text(value.sourceId)) addSource(value, pointer);
    for (const [k, v] of Object.entries(value)) {
      if (["sourceUrls", "evidenceUrls"].includes(k)) for (const u of strings(v).filter(u => publicUrl(u))) addSource(value, pointer, u);
      else if (typeof v === "object") sourceWalk(v, `${pointer}/${pointerPart(k)}`);
    }
  }
  sourceWalk(original, "");
  const refs = (raw: AnyItem, pointer: string): string[] => unique([...(sourcePointers.get(pointer) ?? []), ...strings(raw.sourceIds).flatMap(id => sourceAliases.get(id) ?? []), ...strings(raw.evidenceUrls).flatMap(id => sourceAliases.get(id) ?? [])]);
  const observations = new Map<string, { item: AnyItem; pointer: string; owner: string | null; originalIds: string[] }>();
  function addObservation(kind: string, data: AnyItem, raw: AnyItem, pointer: string, owner: string | null, extraRefs: string[] = []) {
    const date = recordedDate(raw.observedAt ?? raw.observedOn ?? raw.observed_at);
    const sourceIds = unique([...refs(raw, pointer), ...extraRefs]);
    const retracted = raw.evidenceState === "retracted" || raw.disposition === "retracted" || ["retracted", "retracted-disproven"].includes(raw.state);
    const reason = text(raw.retractionReason) ?? (retracted ? text(raw.reason) ?? text(raw.boundary) : null);
    if (retracted && !reason) { issues.push({ code: "hold_schema", path: pointer, reason: "Retraction has no recorded reason; original retained without inventing one." }); return; }
    const semantic = { evidenceState: retracted ? "retracted" : "asserted", retractionReason: reason, retractionSourceIds: retracted ? sourceIds : [], missingProvenanceReason: date.missingProvenanceReason ?? (!sourceIds.length ? "source_reference_not_recorded" : null), kind, observedAt: date.observedAt, observedOn: date.observedOn, sourceIds, data };
    const observationId = eventId("obs", system, researchKey, kind, semantic, raw.observationId ?? raw.findingId ?? raw.id);
    const item = { observationId, ...semantic, existingRecord: null };
    const prior = observations.get(observationId);
    if (prior && protocolHash(prior.item) !== protocolHash(item)) issues.push({ code: "source_event_conflict", path: pointer, reason: "Same original observation ID has different content." });
    else observations.set(observationId, { item, pointer, owner, originalIds: [raw.observationId, raw.findingId, raw.id].filter(v => typeof v === "string") });
  }
  function scope(raw: AnyItem, p: string, owner: string | null) {
    const office = object(raw.office) ? raw.office : null;
    if (office || object(raw.independence)) {
      const fit = object(raw.firmFit) ? raw.firmFit : {};
      const independence = object(raw.independence) ? raw.independence : {};
      const offices = office && Array.isArray(office.offices) ? office.offices.filter(object) : office ? [office] : [];
      for (const [index, current] of offices.entries()) {
        const locationPath = office && Array.isArray(office.offices) ? `${p}/office/offices/${index}` : `${p}/office`;
        // No geographic/independence fact is inferred from a city name or missing fields.
        addObservation("firm_fit", { practiceAreas: strings(raw.practiceAreas), office: { city: text(current.city), province: text(current.province) ?? text(office?.province), address: text(current.address) }, lawyerCount: null, countQualifier: "unknown", independence: enumeration(independence.state, ["independent", "network-affiliated", "branch-office", "unknown"], independence.verified === true ? "independent" : "unknown"), fit: gate(fit.fit) }, current, locationPath, owner, refs(independence, `${p}/independence`));
        ["city", "province", "address"].forEach(k => { if (k in current) mark(`${locationPath}/${k}`); });
      }
    }
    for (const [key, value] of Object.entries(raw)) {
      const at = `${p}/${pointerPart(key)}`;
      if (["services", "serviceObservations"].includes(key)) list(value).forEach((v, i) => {
        if (!object(v)) return;
        const name = text(v.name) ?? text(v.description) ?? text(v.niche);
        if (name) { addObservation("service", { name, matterFit: enumeration(v.matterFit, ["strong-match", "partial-match", "no-match", "unknown"]) }, v, `${at}/${i}`, owner); mark(`${at}/${i}/${v.name ? "name" : v.description ? "description" : "niche"}`); }
      });
      if (["lawyerCount", "lawyerCountEvidence", "size"].includes(key) && object(value)) {
        const count = value.count ?? value.currentObservedLawyerCount;
        const qualifier = count == null ? "unknown" : enumeration(value.countQualifier ?? value.qualifier, ["exact", "at_least", "unknown"], value.firmWide === true && value.activePractisingOnly === true ? "exact" : "unknown");
        const roster = list(value.roster), names = roster.map(v => typeof v === "string" ? v : object(v) ? text(v.name) : null).filter((v): v is string => !!v);
        const excludedPeople = list(value.exclusions).filter(object).filter(v => text(v.name) && text(v.reason)).map(v => ({ name: v.name, reason: v.reason }));
        addObservation("roster", { lawyerCount: Number.isInteger(count) && Number(count) >= 0 ? count : null, countQualifier: qualifier, display: text(value.display) ?? text(value.countDisplay), includedNames: unique(names), excludedPeople }, value, at, owner);
        ["count", "countQualifier", "qualifier", "display", "countDisplay", "currentObservedLawyerCount"].forEach(k => { if (k in value) mark(`${at}/${k}`); });
      }
      if (["email", "directPublishedEmail", "generalInbox", "contact"].includes(key) && object(value)) {
        const address = text(value.address) ?? text(value.personalProfessionalEmail) ?? text(value.contactValue), person: AnyItem = object(raw.decisionMaker) ? raw.decisionMaker : object(r.decisionMaker) ? r.decisionMaker : {};
        const direct = key !== "generalInbox" && address !== null && value.inferred !== true && !!(text(value.attributedTo) ?? text(value.personName));
        const rolePointer = `${p}/decisionMaker/roleEvidence`, roleRefs = refs(object(person.roleEvidence) ? person.roleEvidence : {}, rolePointer);
        addObservation("contact", { personName: text(value.attributedTo) ?? text(value.personName) ?? text(person.name), roleLabel: text(person.role), roleVerification: enumeration(value.roleVerification, ["first-party", "reputable-directory", "unverified", "not-observed"], "unverified"), contactType: key === "generalInbox" ? "general-inbox" : direct ? "public-named-email" : "not-observed", contactValue: address, contactQuality: key === "generalInbox" ? "general-route" : direct ? "published-direct-unverified" : "not-observed", deliverability: enumeration(value.deliverability, ["verified", "not-tested", "failed", "not-applicable"], "not-tested"), roleSourceIds: roleRefs }, value, at, owner, roleRefs);
        ["address", "personalProfessionalEmail", "attributedTo", "personName", "contactValue"].forEach(k => { if (k in value) mark(`${at}/${k}`); });
      }
      const ads = key === "advertising" && object(value) ? list(value.observations) : key === "advertisingObservations" ? list(value) : null;
      if (ads) ads.forEach((v, i) => {
        if (!object(v)) return;
        const adPath = key === "advertising" ? `${at}/observations/${i}` : `${at}/${i}`;
        const tag = ["pixel", "ads-tag", "conversion-tag"].includes(String(v.kind)) && !!text(v.identifier ?? v.signalId);
        const evidenceType = tag ? "advertising-pixel" : enumeration(v.evidenceType ?? v.kind, ["direct-ad", "sponsored-placement", "historical-ad"], null);
        if (!evidenceType) { issues.push({ code: "retained_only", path: adPath, reason: "Unclassified advertising hint/failure is not promoted to advertising evidence." }); return; }
        addObservation("advertising", { evidenceType, vendor: text(v.vendor), signalType: text(v.signalType) ?? text(v.kind), signalId: text(v.signalId) ?? text(v.identifier), advertiserIdentity: text(v.advertiserIdentity) ?? text(v.advertiser), advertisedService: text(v.advertisedService), destinationUrl: publicUrl(v.destinationUrl), effectiveDate: recordedDate(v.effectiveDate ?? v.adDate).observedOn, lastShownDate: recordedDate(v.lastShownDate).observedOn, recencyBasis: text(v.recencyBasis), identityState: enumeration(v.identityState, ["confirmed", "unresolved", "conflict"], "unresolved"), attributable: v.attributable === true, configured: typeof v.configured === "boolean" ? v.configured : null, fired: typeof v.fired === "boolean" ? v.fired : null }, v, adPath, owner);
        ["vendor", "signalType", "kind", "signalId", "identifier", "attributable", "configured", "fired"].forEach(k => { if (k in v) mark(`${adPath}/${k}`); });
      });
      if (["opportunity", "websiteIntake", "websiteIntakeFindings"].includes(key)) (Array.isArray(value) ? value : [value]).forEach((v, i) => {
        if (!object(v)) return;
        const opPath = Array.isArray(value) ? `${at}/${i}` : at, rawObservation = object(v.rawObservation) ? v.rawObservation : v;
        const observation = text(rawObservation.observation), interpretation = text(rawObservation.interpretation) ?? text(rawObservation.implication), recommendation = text(rawObservation.recommendation);
        if (observation && interpretation && recommendation) {
          const confidence = enumeration(rawObservation.confidence, ["high", "medium", "low"], null);
          if (confidence === null) {
            const retainedPath = opPath + (rawObservation !== v ? "/rawObservation" : "") + (Object.hasOwn(rawObservation, "confidence") ? "/confidence" : "");
            retainedPointers.add(prefix + retainedPath);
            issues.push({ code: "opportunity_confidence_not_recorded", path: prefix + retainedPath, reason: "opportunity_confidence_not_recorded" });
            return;
          }
          addObservation("opportunity", { type: enumeration(v.type, ["advertising-verification-gap", "landing-page-message-gap", "service-routing-gap", "intake-context-gap", "local-discovery-gap", "other"], "other"), observation, interpretation, recommendation, strengths: strings(rawObservation.strengths ?? rawObservation.positiveFindings), unknowns: strings(rawObservation.unknowns ?? rawObservation.limits), confidence }, v, opPath, owner);
          for (const k of ["observation", "interpretation", "implication", "recommendation", "strengths", "positiveFindings", "unknowns", "limits", "confidence"]) if (k in rawObservation) mark(`${opPath}${rawObservation !== v ? "/rawObservation" : ""}/${k}`);
        } else issues.push({ code: "retained_only", path: opPath, reason: "Partial opportunity preserved in original research; missing reasoning is not fabricated." });
      });
    }
  }
  scope(r, recordPrefix, null);
  for (const a of assessments) if (object(a.raw.criteria)) scope(a.raw.criteria, `${a.pointer}/criteria`, a.pointer);
  const packages: CompiledPackage[] = [], assigned = new Set<string>();
  const groups: { assessment: AnyItem | null; pointer: string; items: AnyItem[]; sourceIds: string[]; status: unknown; projections: LegacyAssessmentProjectionClaim[] }[] = [];
  for (const entry of assessments) {
    const a = entry.raw, criteria = object(a.criteria) ? a.criteria : {};
    const explicit = new Set([...strings(a.observationIds), ...strings(a.findingIds)]);
    const selected = [...observations.values()].filter(v => v.owner === entry.pointer || v.originalIds.some(id => explicit.has(id)));
    selected.forEach(v => assigned.add(v.item.observationId));
    const sourceIds = unique([...refs(a, entry.pointer), ...selected.flatMap(v => v.item.sourceIds)]);
    const status = a.qualificationState ?? a.databaseDecision ?? a.disposition ?? a.status ?? r.qualificationState ?? null;
    const cohortId = text(a.cohortId) ?? text(a.qualificationCohort) ?? "legacy-unknown-cohort";
    const date = recordedDate(a.assessedAt ?? a.assessedOn ?? a.decidedAt);
    const semantic = { cohortId, ruleVersion: text(a.ruleVersion) ?? text(a.criteriaVersion) ?? "legacy-unknown-rule", assessedAt: date.observedAt, assessedOn: date.observedOn, missingProvenanceReason: date.missingProvenanceReason, researchOutcome: enumeration(a.researchOutcome, ["complete", "partial", "blocked", "error", "not_run", "unknown"]), advertisingStatus: enumeration(a.advertisingStatus ?? (object(r.advertising) ? r.advertising.status : null), ["pixels-detected", "recent-ad-verified", "historical-ad-only", "not-observed"], null), advertisingStatusState: enumeration(a.advertisingStatusState, ["current", "stale", "unknown"]), fitDecision: gate(a.fitDecision), commercialRelevance: enumeration(a.commercialRelevance, ["strong-match", "partial-match", "no-match", "unknown"]), decisionMakerAccess: gate(a.decisionMakerAccess), opportunityDecision: gate(a.opportunityDecision), selectionDisposition: selectionDisposition(status, cohortId, a.selectedForCohort), missingGates: strings(a.missingGates ?? r.missingGates), researchFailures: list(a.researchFailures ?? r.researchFailures).filter(object).map(f => ({ sourceId: refs(f, "")[0] ?? null, outcome: text(f.outcome) ?? "legacy-unknown", reason: text(f.reason) ?? text(f.failure) ?? "Failure detail not recorded in source", nextAction: text(f.nextAction) })), rationale: text(a.rationale) ?? text(a.reason) ?? text(r.selectionRationale) ?? "Legacy assessment rationale not recorded in source", sourceIds, legacyCriteria: { ...(clean(criteria) as Record<string, JsonValue>), originalStatus: clean(status) } };
    semantic.researchFailures.forEach(f => { if (f.sourceId && !sourceIds.includes(f.sourceId)) sourceIds.push(f.sourceId); });
    const assessmentId = eventId("assess", system, researchKey, "assessment", semantic, a.assessmentId);
    const projections = selected.filter(v => v.owner === entry.pointer && v.pointer.startsWith(entry.pointer + "/criteria/")).flatMap(v => {
      const claim = projectionClaim({ observationId: v.item.observationId, parentAssessmentId: assessmentId, sourcePointer: prefix + v.pointer, criteriaSelector: v.pointer.slice(entry.pointer.length) }, content);
      return claim ? [claim] : [];
    });
    groups.push({ assessment: { assessmentId, ...semantic, existingRecord: null }, pointer: text(a.assessmentId) ?? (entry.pointer || "root-assessment"), items: selected.map(v => v.item), sourceIds, status, projections });
    if (a.criteria !== undefined) mark(`${entry.pointer}/criteria`);
  }
  const unassigned = [...observations.values()].filter(v => !assigned.has(v.item.observationId)).map(v => v.item);
  const assignedSources = new Set(groups.flatMap(g => g.sourceIds));
  const unassignedSources = unique([...unassigned.flatMap(v => v.sourceIds), ...[...sourceMap.keys()].filter(id => !assignedSources.has(id))]);
  if (unassigned.length || unassignedSources.length || !groups.length) groups.push({ assessment: null, pointer: "unassigned", items: unassigned, sourceIds: unassignedSources, status: original.databaseDecision ?? original.disposition ?? original.status ?? null, projections: [] });
  const unmappedPaths = unique([...leafPointers(content).filter(p => ![...covered].some(c => p === c || p.startsWith(`${c}/`))), ...retainedPointers]).sort(ordinal);
  for (const group of groups) {
    const runId = `backfill-${manifest.manifestSha256.slice(0, 48)}`;
    const packageId = `pe-${protocolHash([ADAPTER_VERSION, runId, input.artifact.fileSha256, input.pointer, group.pointer])}`;
    const envelope = { schemaVersion: "prospect-enrichment/v1", runId, packageId, supersedesPackageId: null, sourceSystem: SOURCE_SYSTEM, sourceName: SOURCE_NAME, generatedAt: manifest.snapshotAt, mode: "propose", subject, sources: group.sourceIds.map(id => sourceMap.get(id)).filter(Boolean), observations: group.items, assessment: group.assessment, originalResearch: { sourcePath: `${input.artifact.sourceRoot}/${input.artifact.relativePath}`, sourceSha256: input.artifact.fileSha256, sourcePointer: input.pointer, contentSha256: protocolHash(content), content, unmappedPaths }, controls: { contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false } };
    const validation = parseProspectEnrichmentEnvelope(envelope);
    if (!validation.ok) { issues.push(...validation.issues.map(i => ({ code: "hold_schema", path: `${input.pointer}:${group.pointer}:${i.path}`, reason: i.message }))); continue; }
    if (Buffer.byteLength(JSON.stringify(envelope)) > 2_097_152) { issues.push({ code: "hold_limit", path: input.pointer, reason: "Complete envelope exceeds 2 MiB; original archived, no truncation." }); continue; }
    const evidenceHold = !group.items.length || group.items.some(v => !v.sourceIds.length || v.missingProvenanceReason) || !!group.assessment?.missingProvenanceReason;
    packages.push({ envelope: validation.envelope, payloadSha256: protocolHash(validation.envelope), state: evidenceHold ? "evidence_hold" : "identity_hold", displayCategory: displayCategory(group.status), originalStatus: group.status, issues: [...issues], legacyAssessmentProjectionClaims: group.projections });
  }
  return { researchKey, packages, issues, retainedOriginal: content };
}
