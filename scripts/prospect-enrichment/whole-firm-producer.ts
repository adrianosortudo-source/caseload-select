import { parseProspectEnrichmentEnvelope, type JsonValue, type ProspectEnrichmentKind, type ProspectEnrichmentObservation, type ProspectEnrichmentSource } from "../../src/lib/prospect-enrichment-contract";
import { canonicalJson, leafPointers, list, object, ordinal, pointerPart, protocolHash, publicUrl, recordedDate, selectionDisposition, strings, text, unique, type Issue, type JsonObject } from "./model";
import { WHOLE_FIRM_PROFILE } from "./profiles";
import type { WholeFirmCoordinatorExport } from "./whole-firm";
import { projectionClaim, type LegacyAssessmentProjectionClaim } from "./legacy-projections";

export type CoordinatorSourceProvenance = { sourcePath: string; sourceSha256: string; references: CoordinatorReference[] };
export type CoordinatorReference = { pointer: string; value: unknown; sourcePath: string | null; sourceSha256: string | null; archivePath: string | null; status: string; expectedSha256: string | null };
type Finding = { item: ProspectEnrichmentObservation; pointer: string; owner: string | null; originalId: string | null };
const pick = (v: unknown, choices: readonly string[], fallback: string | null = "unknown") => choices.includes(String(v)) ? String(v) : fallback;
const gate = (v: unknown) => pick(v, ["pass", "fail", "unknown"]);
const json = (v: unknown): JsonValue => JSON.parse(canonicalJson(v));
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stable = /^FIRM-[0-9A-HJKMNP-TV-Z]{26}$/;
const sourceKey = /^[a-z0-9][a-z0-9-]{1,159}$/;
/** Whole-firm event IDs use the whole-firm adapter namespace, never the legacy adapter constant. */
function eventId(prefix: string, key: string, kind: string, semantic: unknown, originalId?: unknown): string {
  return prefix + "-" + protocolHash(text(originalId)
    ? [WHOLE_FIRM_PROFILE.adapterVersion, WHOLE_FIRM_PROFILE.sourceSystem, kind, originalId]
    : [WHOLE_FIRM_PROFILE.adapterVersion, WHOLE_FIRM_PROFILE.sourceSystem, key, kind, semantic]).slice(0, 48);
}

/** No filesystem, source retrieval, identity resolution, truth adjudication, or transport. */
export function produceWholeFirmExport(input: unknown, provenance: CoordinatorSourceProvenance, snapshotAt: string) {
  if (!object(input) || input.schemaVersion !== "whole-firm-coordinator-v1" || !Array.isArray(input.candidates) || !sha(provenance.sourceSha256)) throw Error("coordinator_state_schema_invalid");
  const expectedRevisions: WholeFirmCoordinatorExport["expectedRevisions"] = [], revisions: unknown[] = [], issues: Issue[] = [];
  const push = (key: string, pointer: string, originalRevision: JsonValue, envelope: unknown, revisionIssues: Issue[], legacyAssessmentProjectionClaims: LegacyAssessmentProjectionClaim[] = []) => {
    const revisionId = "revision-" + protocolHash([key, pointer, originalRevision]).slice(0, 48);
    expectedRevisions.push({ revisionId, researchKey: key });
    revisions.push({ revisionId, originalRevision, ...(envelope ? { standardEnvelope: envelope } : {}), producerIssues: revisionIssues, legacyAssessmentProjectionClaims });
    issues.push(...revisionIssues);
  };
  input.candidates.forEach((candidateValue, ci) => {
    const cp = "/candidates/" + ci, candidate = object(candidateValue) ? candidateValue : {};
    const context = Object.fromEntries(Object.entries(candidate).filter(([k]) => k !== "results"));
    const hasResults = Array.isArray(candidate.results) && candidate.results.length > 0;
    const rawResults = hasResults ? candidate.results as unknown[] : [null];
    rawResults.forEach((storedValue, ri) => {
      const raw = object(storedValue) ? storedValue : null, rp = hasResults ? cp + "/results/" + ri : cp;
      const key = text(raw?.researchKey) ?? text(raw?.workKey) ?? text(candidate.key);
      const researchKey = key ?? "archive-candidate:" + protocolHash([provenance.sourcePath, provenance.sourceSha256, rp]);
      const base = { schemaVersion: "whole-firm-producer-revision/v1", disposition: raw?.disposition ?? candidate.status ?? null, candidateContext: json(!object(candidateValue) ? candidateValue : !Array.isArray(candidate.results) ? candidate : context), result: json(storedValue), split: { assessmentPointer: null as string | null, unassigned: true } };
      const revisionIssues: Issue[] = [];
      const addIssue = (code: string, pointer: string, reason = code) => revisionIssues.push({ code, path: pointer, reason });
      if (!key) addIssue("research_key_missing", rp);
      if (!object(candidateValue) || !Array.isArray(candidate.results)) addIssue("coordinator_candidate_schema_invalid", cp);
      if (hasResults && (!raw || !text(raw.resultId) || !text(raw.workKey) || !["complete", "held", "rejected"].includes(String(raw.disposition)) || !Array.isArray(raw.evidence) || !Array.isArray(raw.missingGates) || !Array.isArray(raw.researchFailures) || !object(raw.record) || (["held", "rejected"].includes(String(raw.disposition)) && !text(raw.reason)))) addIssue("coordinator_result_schema_invalid", rp);
      if (revisionIssues.length) { push(researchKey, rp, json(base), null, revisionIssues); return; }
      if (!raw) {
        push(researchKey, rp, json(base), null, [{ code: "coordinator_result_not_recorded", path: rp, reason: "Candidate has no completed result; retain every original field." }]); return;
      }
      const record = raw.record as JsonObject, sources: ProspectEnrichmentSource[] = [], sourcePointers = new Map<string, string[]>(), aliases = new Map<string, string[]>();
      const covered = new Set<string>(), findings: Finding[] = [];
      const mark = (p: string) => covered.add("/result" + p);
      const addSource = (value: JsonObject, pointer: string) => {
        const url = publicUrl(value.sourceUrl ?? value.url ?? value.pageUrl), date = recordedDate(value.observedAt ?? value.observedOn);
        if (!url && !Object.hasOwn(value, "sourceId") && !Object.hasOwn(value, "requestedUrl")) return;
        const publication = text(value.publicationLabel) ?? text(value.publicationDate);
        const semantic = { url, requestedUrl: publicUrl(value.requestedUrl), finalUrl: publicUrl(value.finalUrl), policyState: pick(value.policyState, ["public-source", "policy-blocked", "legacy-unknown"], "legacy-unknown"), publicationLabel: publication, publicationPrecision: publication && /^\d{4}$/.test(publication) ? "year" : publication && /^\d{4}-\d{2}-\d{2}$/.test(publication) ? "exact_date" : "unknown", publisher: text(value.publisher), observedAt: date.observedAt, observedOn: date.observedOn, retrievedAt: recordedDate(value.retrievedAt).observedAt, retrievalMethod: text(value.retrievalMethod) ?? "legacy-unknown", retrievalOutcome: text(value.retrievalOutcome) ?? "legacy-unknown", httpStatus: Number.isInteger(value.httpStatus) ? value.httpStatus : null, bodySha256: sha(value.bodySha256 ?? value.captureSha256) ? value.bodySha256 ?? value.captureSha256 : null, excerpt: text(value.excerpt) ?? text(value.configurationEvidence), missingProvenanceReason: date.missingProvenanceReason ?? (!url ? "source_url_not_recorded" : null) };
        const id = eventId("src", researchKey, "source", semantic, value.sourceId), source = { sourceId: id, ...semantic } as ProspectEnrichmentSource;
        const prior = sources.find(s => s.sourceId === id);
        if (prior && protocolHash(prior) !== protocolHash(source)) addIssue("source_event_conflict", "/result" + pointer);
        else if (!prior) sources.push(source);
        sourcePointers.set(pointer, unique([...(sourcePointers.get(pointer) ?? []), id]));
        if (text(value.sourceId)) aliases.set(String(value.sourceId), unique([...(aliases.get(String(value.sourceId)) ?? []), id]));
      };
      const walkSources = (v: unknown, p: string) => { if (Array.isArray(v)) v.forEach((child, i) => walkSources(child, p + "/" + i)); else if (object(v)) { addSource(v, p); Object.entries(v).forEach(([k, child]) => walkSources(child, p + "/" + pointerPart(k))); } };
      walkSources(raw, "");
      const refs = (v: JsonObject, p: string) => unique([...(sourcePointers.get(p) ?? []), ...strings(v.sourceIds).flatMap(id => aliases.get(id) ?? [])]);
      const add = (kind: ProspectEnrichmentKind, data: unknown, v: JsonObject, p: string, owner: string | null, extra: string[] = []) => {
        const date = recordedDate(v.observedAt ?? v.observedOn), sourceIds = unique([...refs(v, p), ...extra]);
        const retracted = v.evidenceState === "retracted" || v.state === "retracted" || v.state === "retracted-disproven";
        const reason = retracted ? text(v.retractionReason) ?? text(v.reason) : null;
        if (retracted && !reason) { addIssue("retraction_reason_not_recorded", "/result" + p); return; }
        const retractionSourceIds = retracted ? unique(strings(v.retractionSourceIds).flatMap(id => aliases.get(id) ?? [])) : [];
        for (const id of retractionSourceIds) if (!sourceIds.includes(id)) sourceIds.push(id);
        const semantic = { evidenceState: retracted ? "retracted" : "asserted", retractionReason: reason, retractionSourceIds, missingProvenanceReason: date.missingProvenanceReason ?? (retracted && !retractionSourceIds.length ? "retraction_source_not_recorded" : !sourceIds.length ? "source_reference_not_recorded" : null), kind, observedAt: date.observedAt, observedOn: date.observedOn, sourceIds, data };
        const id = eventId("obs", researchKey, kind, semantic, v.observationId ?? v.findingId);
        const item = { observationId: id, ...semantic, existingRecord: null } as ProspectEnrichmentObservation;
        const prior = findings.find(f => f.item.observationId === id);
        if (prior && protocolHash(prior.item) !== protocolHash(item)) addIssue("observation_event_conflict", "/result" + p);
        else if (!prior) findings.push({ item, pointer: p, owner, originalId: text(v.observationId) ?? text(v.findingId) });
      };
      const scope = (r: JsonObject, p: string, owner: string | null) => {
        const office = object(r.office) ? r.office : null, independence = object(r.independence) ? r.independence : {};
        if (office) {
          add("firm_fit", { practiceAreas: strings(r.practiceAreas), office: { city: text(office.city), province: text(office.province), address: text(office.address) }, lawyerCount: null, countQualifier: "unknown", independence: pick(independence.state, ["independent", "network-affiliated", "branch-office", "unknown"], independence.verified === true ? "independent" : "unknown"), fit: gate(object(r.firmFit) ? r.firmFit.fit : null) }, office, p + "/office", owner, refs(independence, p + "/independence"));
          ["city","province","address"].forEach(k => mark(p + "/office/" + k));
        }
        list(r.services).forEach((v, i) => { if (!object(v)) return; const name = text(v.name) ?? text(v.description) ?? text(v.niche); if (!name) return; add("service", { name, matterFit: pick(v.matterFit, ["strong-match","partial-match","no-match","unknown"]) }, v, p + "/services/" + i, owner); mark(p + "/services/" + i + "/" + (v.name ? "name" : v.description ? "description" : "niche")); });
        if (object(r.lawyerCount)) {
          const v = r.lawyerCount, claimedCount = Number.isInteger(v.count) && Number(v.count) >= 0 ? Number(v.count) : null;
          const qualifier = pick(v.countQualifier, ["exact","at_least","unknown"], claimedCount !== null && v.firmWide === true && v.activePractisingOnly === true ? "exact" : "unknown"), count = qualifier === "unknown" ? null : claimedCount;
          if (claimedCount !== null && count === null) addIssue("roster_count_qualifier_not_recorded", "/result" + p + "/lawyerCount/count");
          add("roster", { lawyerCount: count, countQualifier: count === null ? "unknown" : qualifier, display: text(v.display) ?? (count === null ? "Unknown" : String(count)), includedNames: unique(list(v.roster).flatMap(person => typeof person === "string" ? [person] : object(person) && text(person.name) ? [String(person.name)] : [])), excludedPeople: list(v.exclusions).filter(object).filter(person => text(person.name) && text(person.reason)).map(person => ({ name: person.name, reason: person.reason })) }, v, p + "/lawyerCount", owner);
          if (count !== null) mark(p + "/lawyerCount/count");
        }
        const person = object(r.decisionMaker) ? r.decisionMaker : {};
        for (const k of ["email","generalInbox"] as const) if (object(r[k])) {
          const v = r[k], direct = k === "email" && v.inferred !== true && !!text(v.address) && !!text(v.attributedTo) && v.attributedTo === person.name;
          const role = object(person.roleEvidence) ? person.roleEvidence : {}, roleRefs = refs(role, p + "/decisionMaker/roleEvidence");
          add("contact", { personName: text(v.attributedTo) ?? text(person.name), roleLabel: text(person.role), roleVerification: pick(v.roleVerification, ["first-party","reputable-directory","unverified","not-observed"], "unverified"), contactType: k === "generalInbox" ? "general-inbox" : direct ? "public-named-email" : "not-observed", contactValue: text(v.address), contactQuality: k === "generalInbox" ? "general-route" : direct ? "published-direct-unverified" : "not-observed", deliverability: pick(v.deliverability, ["verified","not-tested","failed","not-applicable"], "not-tested"), roleSourceIds: roleRefs }, v, p + "/" + k, owner, roleRefs);
          mark(p + "/" + k + "/address"); mark(p + "/" + k + "/attributedTo");
        }
        if (object(r.advertising)) list(r.advertising.observations).forEach((v, i) => {
          if (!object(v)) return; const at = p + "/advertising/observations/" + i;
          const tag = (v.vendor === "meta" && v.kind === "pixel" && /^\d+$/.test(String(v.identifier))) || (["google","google_ads"].includes(String(v.vendor)) && ["conversion-tag","ads-tag"].includes(String(v.kind)) && /^AW-\d+$/.test(String(v.identifier)));
          const kind = tag ? "advertising-pixel" : v.kind === "recent-ad" ? "direct-ad" : pick(v.kind, ["direct-ad","sponsored-placement","historical-ad"], null);
          if (!kind) { addIssue("advertising_hint_retained_only", "/result" + at); return; }
          add("advertising", { evidenceType: kind, vendor: text(v.vendor), signalType: text(v.kind), signalId: text(v.identifier), advertiserIdentity: text(v.advertiser), advertisedService: text(v.advertisedService), destinationUrl: publicUrl(v.destinationUrl), effectiveDate: recordedDate(v.adDate ?? v.effectiveDate).observedOn, lastShownDate: recordedDate(v.lastShownDate).observedOn, recencyBasis: text(v.recencyBasis), identityState: pick(v.identityState, ["confirmed","unresolved","conflict"], "unresolved"), attributable: v.attributable === true, configured: typeof v.configured === "boolean" ? v.configured : null, fired: typeof v.fired === "boolean" ? v.fired : null }, v, at, owner);
          ["vendor","kind","identifier","advertiser","adDate"].forEach(k => mark(at + "/" + k));
        });
        if (object(r.opportunity)) {
          const v = r.opportunity, at = p + "/opportunity", confidence = pick(v.confidence, ["high","medium","low"], null);
          if (confidence === null) addIssue("opportunity_confidence_not_recorded", "/result" + at + (Object.hasOwn(v,"confidence") ? "/confidence" : ""));
          if (text(v.observation) && text(v.interpretation ?? v.implication) && text(v.recommendation) && confidence) {
            add("opportunity", { type: pick(v.type, ["advertising-verification-gap","landing-page-message-gap","service-routing-gap","intake-context-gap","local-discovery-gap","other"], "other"), observation: v.observation, interpretation: v.interpretation ?? v.implication, recommendation: v.recommendation, strengths: strings(v.strengths), unknowns: strings(v.unknowns), confidence }, v, at, owner);
            ["observation","interpretation","implication","recommendation","strengths","unknowns","confidence"].forEach(k => mark(at + "/" + k));
          } else addIssue("opportunity_reasoning_retained_only", "/result" + at);
        }
        for (const key of ["websiteIntake", "websiteIntakeFindings"]) for (const [i, value] of (Array.isArray(r[key]) ? r[key] as unknown[] : r[key] === undefined ? [] : [r[key]]).entries()) {
          if (!object(value)) continue; const at = p + "/" + key + (Array.isArray(r[key]) ? "/" + i : "");
          if (publicUrl(value.pageUrl) && Array.isArray(value.visibleChannels) && Array.isArray(value.visibleFields) && ["supported", "not_established"].includes(String(value.opportunityState)) && text(value.summary) && text(value.observation) && text(value.interpretation)) {
            add("website_intake", { pageUrl: value.pageUrl, visibleChannels: strings(value.visibleChannels), visibleFields: strings(value.visibleFields), opportunityState: value.opportunityState, summary: value.summary, observation: value.observation, interpretation: value.interpretation, recommendation: text(value.recommendation), unknowns: strings(value.unknowns) }, value, at, owner);
            for (const field of ["pageUrl","visibleChannels","visibleFields","opportunityState","summary","observation","interpretation","recommendation","unknowns"]) mark(at + "/" + field);
          } else addIssue("website_intake_retained_only", "/result" + at);
        }
        list(r.researchFailures).forEach((v, i) => {
          if (!object(v)) return; const at = p + "/researchFailures/" + i;
          if (text(v.provider) && text(v.queryOrUrl ?? v.sourceUrl) && text(v.outcome) && ["complete","partial","failed","not-run"].includes(String(v.coverage))) add("research_attempt", { provider: v.provider, queryOrUrl: v.queryOrUrl ?? v.sourceUrl, outcome: v.outcome, coverage: v.coverage, failureReason: text(v.reason) ?? text(v.failure) }, v, at, owner);
        });
      };
      const assessments = [...list(raw.qualificationAssessments).map((v,i)=>({v,p:"/qualificationAssessments/"+i})), ...list(record.qualificationAssessments).map((v,i)=>({v,p:"/record/qualificationAssessments/"+i}))];
      if (!assessments.length) assessments.push({ v: raw, p: "" });
      scope(record, "/record", assessments.length === 1 && assessments[0].p === "" ? "" : null);
      scope({ researchFailures: raw.researchFailures }, "", assessments.length === 1 && assessments[0].p === "" ? "" : null);
      for (const a of assessments) if (object(a.v) && object(a.v.criteria)) scope(a.v.criteria, a.p + "/criteria", a.p);
      const packet = object(raw.researchKey) ? raw.researchKey : {}, claims = {
        databaseFirmId: unique([record.databaseFirmId, packet.databaseUuid].filter((v): v is string => !!text(v))),
        stableFirmId: unique([record.firmId, packet.stableFirmId].filter((v): v is string => !!text(v))),
        sourceRecordKey: unique([record.sourceRecordKey, packet.sourceRecordKey].filter((v): v is string => !!text(v))),
      };
      const valid = { databaseFirmId: uuid, stableFirmId: stable, sourceRecordKey: sourceKey };
      const conflicting = Object.keys(claims).some(k => { const name = k as keyof typeof claims; return claims[name].length > 1 || claims[name].some(v => !valid[name].test(v)); }) || list(candidate.identityConflicts).length > 0;
      const domain = text(record.canonicalDomain), subject = { researchKey, databaseFirmId: claims.databaseFirmId.length === 1 && uuid.test(claims.databaseFirmId[0]) ? claims.databaseFirmId[0] : null, stableFirmId: claims.stableFirmId.length === 1 && stable.test(claims.stableFirmId[0]) ? claims.stableFirmId[0] : null, sourceRecordKey: claims.sourceRecordKey.length === 1 && sourceKey.test(claims.sourceRecordKey[0]) ? claims.sourceRecordKey[0] : null, canonicalDomain: domain, displayName: text(record.firmName) ?? text(candidate.firmName) ?? "Unnamed research candidate", identityState: conflicting ? "conflict" : "unresolved" };
      if (conflicting) addIssue("identity_claim_conflict", "/result/record");
      const groups: { selector: string | null; unassigned: boolean; observations: ProspectEnrichmentObservation[]; sourceIds: string[]; assessment: unknown; projections: LegacyAssessmentProjectionClaim[] }[] = [], assigned = new Set<string>();
      for (const a of assessments) {
        if (!object(a.v)) { addIssue("assessment_schema_invalid", "/result" + a.p); continue; }
        const value = a.v, explicit = new Set([...strings(value.observationIds), ...strings(value.findingIds)]);
        const selected = findings.filter(f => f.owner === a.p || (f.originalId && explicit.has(f.originalId)));
        selected.forEach(f => assigned.add(f.item.observationId));
        const failures = list(value.researchFailures).filter(object).map((f,i) => ({ sourceId: refs(f,a.p+"/researchFailures/"+i)[0] ?? null, outcome: text(f.outcome) ?? "legacy-unknown", reason: text(f.reason) ?? text(f.failure) ?? "Failure detail not recorded in source", nextAction: text(f.nextAction) }));
        const ids = unique([...refs(value,a.p), ...selected.flatMap(f => [...f.item.sourceIds,...f.item.retractionSourceIds]), ...failures.flatMap(f => f.sourceId ? [f.sourceId] : [])]);
        const date = recordedDate(value.assessedAt ?? value.assessedOn), cohortId = text(value.cohortId) ?? "whole-firm-unrecorded-cohort";
        const semantic = { cohortId, ruleVersion: text(value.ruleVersion) ?? "whole-firm-unrecorded-rule", assessedAt: date.observedAt, assessedOn: date.observedOn, missingProvenanceReason: date.missingProvenanceReason, researchOutcome: pick(value.researchOutcome, ["complete","partial","blocked","error","not_run","unknown"]), advertisingStatus: pick(value.advertisingStatus ?? (object(record.advertising) ? record.advertising.status : null), ["pixels-detected","recent-ad-verified","historical-ad-only","not-observed"], null), advertisingStatusState: pick(value.advertisingStatusState, ["current","stale","unknown"]), fitDecision: gate(value.fitDecision), commercialRelevance: pick(value.commercialRelevance,["strong-match","partial-match","no-match","unknown"]), decisionMakerAccess: gate(value.decisionMakerAccess), opportunityDecision: gate(value.opportunityDecision), selectionDisposition: selectionDisposition(value.disposition ?? value.databaseDecision ?? value.status, cohortId, value.selectedForCohort), missingGates: unique([...strings(value.missingGates),...strings(raw.computedMissingGates)]).sort(ordinal), researchFailures: failures, rationale: text(value.rationale) ?? text(value.reason) ?? text(record.selectionRationale) ?? "Assessment rationale not recorded in source", sourceIds: ids, legacyCriteria: { ...(object(value.criteria) ? value.criteria : {}), originalStatus: value.disposition ?? value.databaseDecision ?? value.status ?? null }, existingRecord: null };
        const assessmentId = eventId("assess",researchKey,"assessment",semantic,value.assessmentId);
        const projections = selected.filter(f => f.owner === a.p && f.pointer.startsWith(a.p + "/criteria/")).flatMap(f => {
          const claim = projectionClaim({observationId:f.item.observationId,parentAssessmentId:assessmentId,sourcePointer:"/result"+f.pointer,criteriaSelector:f.pointer.slice(a.p.length)},base);
          return claim ? [claim] : [];
        });
        groups.push({ selector:a.p, unassigned:false, observations:selected.map(f=>f.item), sourceIds:ids, assessment:{assessmentId,...semantic}, projections });
      }
      const remaining = findings.filter(f=>!assigned.has(f.item.observationId)), used = new Set(groups.flatMap(g=>g.sourceIds)), unassignedSources = sources.filter(s=>!used.has(s.sourceId)).map(s=>s.sourceId);
      if (remaining.length || unassignedSources.length || !groups.length) groups.push({selector:null,unassigned:true,observations:remaining.map(f=>f.item),sourceIds:unique([...unassignedSources,...remaining.flatMap(f=>[...f.item.sourceIds,...f.item.retractionSourceIds])]),assessment:null,projections:[]});
      for (const group of groups) {
        const original = json({...base,split:{assessmentPointer:group.selector,unassigned:group.unassigned}});
        const unmapped = unique([...leafPointers(original).filter(p=>![...covered].some(c=>p===c||p.startsWith(c+"/"))),...revisionIssues.map(i=>i.path).filter(p=>p.startsWith("/result"))]).sort(ordinal);
        const envelope = {schemaVersion:"prospect-enrichment/v1",runId:"run-prepared",packageId:"pe-prepared",supersedesPackageId:null,sourceSystem:WHOLE_FIRM_PROFILE.sourceSystem,sourceName:WHOLE_FIRM_PROFILE.sourceName,generatedAt:snapshotAt,mode:"propose",subject,sources:sources.filter(s=>group.sourceIds.includes(s.sourceId)),observations:group.observations,assessment:group.assessment,originalResearch:{sourcePath:provenance.sourcePath,sourceSha256:provenance.sourceSha256,sourcePointer:rp,contentSha256:protocolHash(original),content:original,unmappedPaths:unmapped},controls:{contactFormsSubmitted:false,chatSessionsStarted:false,outreachSent:false}};
        const parsed = parseProspectEnrichmentEnvelope(envelope);
        const fatal = revisionIssues.some(i=>["source_event_conflict","observation_event_conflict","assessment_schema_invalid","retraction_reason_not_recorded"].includes(i.code));
        const finalIssues = [...revisionIssues,...(!parsed.ok ? parsed.issues.map(i=>({code:"producer_envelope_schema_invalid",path:rp,reason:i.path+": "+i.message})) : [])];
        push(researchKey,rp+":"+(group.selector??"unassigned"),original,parsed.ok&&!fatal?parsed.envelope:null,finalIssues,group.projections);
      }
    });
  });
  for (const ref of provenance.references.filter(r=>r.status!=="snapshotted")) {
    const match = /^\/candidates\/(\d+)/.exec(ref.pointer), c = match ? input.candidates[Number(match[1])] : null;
    const key = object(c) && text(c.key) ? String(c.key) : "archive-reference:"+protocolHash([provenance.sourceSha256,ref.pointer]);
    push(key,ref.pointer,json({schemaVersion:"whole-firm-reference-hold/v1",reference:ref}),null,[{code:ref.status,path:ref.pointer,reason:"Referenced original is unavailable or unverified; preserve the exact reference and hold it."}]);
  }
  const exported = { schemaVersion:"prospect-whole-firm-coordinator-export/v1" as const,snapshotAt,expectedRevisions,revisions,sourceInventory:{state:json(input),provenance:json(provenance)},producerIssues:issues };
  return { exported, issues, candidateCount:input.candidates.length, revisionCount:revisions.length };
}
