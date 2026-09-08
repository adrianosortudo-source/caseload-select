import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const DEFAULT_SOURCE_ROOT = resolve(
  "C:/Users/adria/OneDrive/Documentos/ChatGPT/CaseLoad Select/_agent_tmp",
);
const OUTPUT_PATH = resolve("src/data/qualified-gta-prospects.json");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : fallback;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function readJson(path) {
  const bytes = await readFile(path);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

function fail(message) {
  throw new Error(`[qualified-prospect-build] ${message}`);
}

function cityFromAddress(address) {
  if (typeof address !== "string") return "Location not recorded";
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 3 ? parts.at(-2) : "Location not recorded";
}

function websiteOpportunityTypes(context) {
  const value = context.toLowerCase();
  const types = [];
  if (/identity|name|address|location|domain|founding|team|profile/.test(value)) types.push("public_identity_consistency");
  if (/phone|fax|form|appointment|inquiry|callback|contact|route/.test(value)) types.push("intake_path_consistency");
  if (/copy|spelling|grammar|placeholder|testimonial|privacy|count|practice-scope|thin lawyer bio/.test(value)) types.push("content_quality");
  if (/malformed|error|javascript|honeypot|frozen|empty|overlap/.test(value)) types.push("technical_path");
  return types.length > 0 ? types : ["public_site_review"];
}

function assertFalseControls(controls, firmName) {
  for (const key of [
    "contact_authorized",
    "send_authorized",
    "delivery_or_publication_authorized",
    "implementation_authorized",
  ]) {
    if (controls[key] !== false) fail(`${firmName}: ${key} must be false`);
  }
}

const sourceRoot = option("--source-root", DEFAULT_SOURCE_ROOT);
const outputPath = option("--output", OUTPUT_PATH);
const handoffPath = join(sourceRoot, "project_completion_qa_2026-09-07", "FINAL_20_FIRM_HANDOFF.json");
const registryPath = join(sourceRoot, "prospect_registry_authority_2026-09-07", "generated", "registry.json");
const auditsPath = join(sourceRoot, "oipr_html_batch_2026-09-07", "data", "audits");

const [handoffInput, registryInput, auditNames] = await Promise.all([
  readJson(handoffPath),
  readJson(registryPath),
  readdir(auditsPath),
]);
const auditFiles = auditNames.filter((name) => name.endsWith(".audit.json")).sort();
const auditInputs = await Promise.all(auditFiles.map(async (name) => ({ name, ...(await readJson(join(auditsPath, name))) })));

const handoff = handoffInput.value;
const registry = registryInput.value;
if (handoff.project_status !== "COMPLETE" || handoff.measurements?.firms !== 20) fail("handoff is not the completed 20-firm cohort");
if (auditInputs.length !== 20) fail(`expected 20 audit records, found ${auditInputs.length}`);
if (!Array.isArray(registry.evidence_records) || registry.evidence_records.length !== 94) fail("registry must contain exactly 94 evidence records");

const auditsByFirmId = new Map(auditInputs.map((input) => [input.value.linkage?.firm_id, input]));
const firmsById = new Map(registry.firms.map((firm) => [firm.firm_id, firm]));
const observationsByFirmId = new Map(registry.lawyer_count_observations.map((observation) => [observation.firm_id, observation]));
const evidenceById = new Map(registry.evidence_records.map((evidence) => [evidence.evidence_id, evidence]));
const projectionByFirmId = new Map(registry.projections.prospects.map((projection) => [projection.firm_id, projection]));
const auditEvidenceById = new Map();
for (const input of auditInputs) {
  for (const evidence of input.value.evidence ?? []) {
    if (!evidence.global_evidence_id) continue;
    const existing = auditEvidenceById.get(evidence.global_evidence_id);
    if (existing && existing.source_type !== evidence.source_type) {
      fail(`audit evidence ${evidence.global_evidence_id} has conflicting source types`);
    }
    auditEvidenceById.set(evidence.global_evidence_id, evidence);
  }
}

function sourceTypeForEvidence(evidenceId) {
  const registryType = evidenceById.get(evidenceId)?.source_type?.trim();
  const auditType = auditEvidenceById.get(evidenceId)?.source_type?.trim();
  const sourceType = registryType || auditType;
  if (!sourceType) fail(`evidence ${evidenceId} has no source type in the registry or linked audit`);
  return sourceType;
}

const dossiers = handoff.firms.map((summary) => {
  const firm = firmsById.get(summary.firm_id);
  const observation = observationsByFirmId.get(summary.firm_id);
  const auditInput = auditsByFirmId.get(summary.firm_id);
  const projection = projectionByFirmId.get(summary.firm_id);
  if (!firm || !observation || !auditInput || !projection) fail(`${summary.firm_name}: registry or audit linkage is incomplete`);
  const audit = auditInput.value;
  if (firm.canonical_domain !== summary.canonical_domain || audit.linkage.domain_candidate !== summary.canonical_domain) {
    fail(`${summary.firm_name}: canonical domains disagree`);
  }
  if (![2, 3].includes(observation.observed_count) || observation.observed_count !== summary.lawyer_count) {
    fail(`${summary.firm_name}: lawyer observation is not an accepted 2 or 3 count`);
  }
  if (observation.review_state !== "accepted" || audit.lawyer_count.accepted !== true) {
    fail(`${summary.firm_name}: lawyer observation is not accepted`);
  }
  if (summary.advertising_spend_claim !== "not_made" || audit.advertising_activity.spend_claim !== "not_made") {
    fail(`${summary.firm_name}: advertising data contains a spend claim`);
  }
  if (audit.gbp_observation.classification !== "opportunity_supported") {
    fail(`${summary.firm_name}: GBP opportunity is not supported`);
  }
  if (audit.website_and_intake.evidence_state !== "registered_public_observation") {
    fail(`${summary.firm_name}: website and intake evidence is not registered`);
  }
  if (audit.controls.internal_html_audit_ready !== true || projection.release_controls.internal_html_audit_ready !== true) {
    fail(`${summary.firm_name}: internal audit is not ready`);
  }
  assertFalseControls(audit.controls, summary.firm_name);
  for (const key of ["contact_authorized", "send_authorized", "outreach_authorized", "form_submission_authorized", "delivery_or_publication_authorized", "pdf_generation_authorized"]) {
    if (projection.release_controls[key] !== false) fail(`${summary.firm_name}: ${key} must be false`);
  }

  const allEvidenceIds = [...new Set(audit.evidence.map((item) => item.global_evidence_id).filter(Boolean))].sort();
  for (const evidenceId of allEvidenceIds) {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence || evidence.firm_id !== summary.firm_id) fail(`${summary.firm_name}: evidence ${evidenceId} is missing or belongs to another firm`);
  }

  const profile = audit.gbp_observation.public_profile_fields ?? {};
  const observedIntakeChannels = audit.website_and_intake.channels
    .filter((item) => /observed/i.test(item.observed_state) && !/^(not|none)/i.test(item.observed_state.trim()))
    .map((item) => item.channel);
  const websiteTypes = websiteOpportunityTypes(audit.website_and_intake.opportunity_context);

  return {
    firmId: summary.firm_id,
    firmName: summary.firm_name,
    canonicalDomain: summary.canonical_domain,
    websiteUrl: `https://${summary.canonical_domain}/`,
    city: cityFromAddress(profile.address),
    officeCities: [cityFromAddress(profile.address)],
    sourceRecordRefs: audit.linkage.source_record_refs,
    identityLimitations: audit.linkage.identity_conflicts,
    lawyerCount: {
      observedCount: observation.observed_count,
      observedAt: observation.observed_at,
      confidence: observation.confidence,
      namedLawyers: summary.named_lawyers,
      sourceType: observation.source_type,
      sourceUrl: audit.lawyer_count.source_url,
      evidenceIds: observation.evidence_refs,
      completenessLimit: observation.completeness_limit,
    },
    advertisingActivity: {
      state: audit.advertising_activity.summary_state,
      summary: audit.advertising_activity.evidence_summary,
      evidenceIds: summary.advertising_evidence_ids,
      sourceTypes: [...new Set(summary.advertising_evidence_ids.map(sourceTypeForEvidence))].sort(),
      spendClaim: "not_made",
      limitations: audit.advertising_activity.limitations,
    },
    gbpOpportunity: {
      type: audit.gbp_observation.opportunity_type,
      reason: audit.gbp_observation.opportunity_reason,
      sourceUrl: audit.gbp_observation.source_url,
      observedAt: audit.gbp_observation.observed_at,
      profileFields: profile,
      recommendedReview: audit.gbp_observation.recommended_human_review,
      limitations: audit.gbp_observation.limitations,
    },
    websiteAndIntake: {
      opportunityTypes: websiteTypes,
      opportunityContext: audit.website_and_intake.opportunity_context,
      sourceUrl: audit.website_and_intake.source_url,
      observedOn: audit.website_and_intake.observed_on,
      evidenceIds: audit.website_and_intake.registered_evidence_ids,
      channels: audit.website_and_intake.channels,
      observedChannels: observedIntakeChannels,
      limitation: audit.website_and_intake.limitation,
    },
    qualification: {
      state: "qualified",
      ruleVersion: "qualified-gta-prospect-v1",
      assessedAt: handoff.generated_at,
      cohortId: "qualified-prospects-2026-09-07",
      criteria: {
        acceptedTwoOrThreeLawyerObservation: true,
        observableAdvertisingActivity: true,
        supportedGbpOpportunity: true,
        registeredWebsiteAndIntakeEvidence: true,
      },
    },
    audit: {
      auditId: audit.audit_id,
      state: "ready",
      sourceFile: basename(auditInput.name),
      observedOn: audit.observation_scope.latest_observation_date,
      verificationPriorities: audit.verification_priorities,
      claimBoundaries: audit.claim_boundaries,
    },
    evidenceIds: allEvidenceIds,
    controls: {
      contactAuthorized: false,
      sendAuthorized: false,
      outreachAuthorized: false,
      formSubmissionAuthorized: false,
      deliveryOrPublicationAuthorized: false,
      implementationAuthorized: false,
      pdfGenerationAuthorized: false,
    },
  };
});

const domainSet = new Set(dossiers.map((dossier) => dossier.canonicalDomain));
const firmIdSet = new Set(dossiers.map((dossier) => dossier.firmId));
if (domainSet.size !== dossiers.length || firmIdSet.size !== dossiers.length) fail("qualified cohort contains duplicate domain or firm identity");

const evidenceRecords = registry.evidence_records
  .filter((evidence) => firmIdSet.has(evidence.firm_id))
  .map((evidence) => ({
    evidenceId: evidence.evidence_id,
    firmId: evidence.firm_id,
    sourceType: sourceTypeForEvidence(evidence.evidence_id),
    sourceUrl: evidence.source_url,
    observedAt: evidence.observed_at,
    captureSha256: evidence.capture_sha256,
    recordLocator: evidence.record_locator,
    registrationScope: evidence.registration_scope,
    limits: evidence.limits,
    disposition: evidence.disposition,
  }))
  .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
if (evidenceRecords.length !== 94 || new Set(evidenceRecords.map((record) => record.evidenceId)).size !== 94) {
  fail("qualified cohort must retain all 94 unique evidence records");
}

const artifact = {
  schemaVersion: "1.0.0",
  generatedAt: handoff.generated_at,
  cohortId: "qualified-prospects-2026-09-07",
  sourceProvenance: {
    handoff: { file: basename(handoffPath), sha256: sha256(handoffInput.bytes) },
    registry: { file: basename(registryPath), sha256: sha256(registryInput.bytes) },
    audits: auditInputs.map((input) => ({ file: input.name, sha256: sha256(input.bytes) })),
  },
  importPolicy: {
    identityKey: "normalized canonical domain",
    duplicatePolicy: "enrich one exact domain match, add when absent, hold when a domain matches multiple records",
    mutationScope: "source-controlled Firm expansion projection only",
  },
  controls: {
    contactAuthorized: false,
    sendAuthorized: false,
    outreachAuthorized: false,
    formSubmissionAuthorized: false,
    deliveryOrPublicationAuthorized: false,
    implementationAuthorized: false,
    pdfGenerationAuthorized: false,
  },
  dossiers,
  evidenceRecords,
};

await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, dossiers: dossiers.length, evidenceRecords: evidenceRecords.length }, null, 2));
