import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { RECONCILED_GTA_PROSPECTS } from "../src/app/admin/prospects/reconciled-prospects";
import { buildOperatorProspectBaseline, normalizeProspectStreetAddress, reconcileProspectCandidateAgainstBaseline, type ProspectBaselineRecord } from "../src/lib/gta-prospect-baseline-reconciliation";
import { GTA_PROSPECT_BATCH_012_SCHEMA_VERSION, deriveGtaProspectBatch012Summary, validateGtaProspectBatch012Document, type GtaProspectBatch012Document, type GtaProspectBatch012Evidence, type GtaProspectBatch012Leadership, type GtaProspectBatch012OfficeAddress, type GtaProspectBatch012PublicEmail, type GtaProspectBatch012Record } from "../src/lib/gta-prospect-batch-012";
import type { ReconciledGtaProspect } from "../src/lib/gta-prospect-records";
import { legacyGtaSourceRecords } from "../src/lib/legacy-gta-prospect-source";

const BATCH_ID = "gta-prospect-batch-012" as const;
const WEST_COMMIT = "c789d49047d5ce1d46a8b4ef6e48c01247717a0b";
const EAST_COMMIT = "a2b8dfe1db49deb39737d4e803d92010df69b1ef";
const NORMALIZER_COMMIT = "337b5cf7a43ab8f00af242c3f6da29290f2b575e";
const ROOT = resolve(process.cwd(), "docs/research/gta-prospect-batch-012");
const RECON_ROOT = resolve(process.cwd(), "docs/reconciliation/gta-prospect-batch-012");
const OFFLINE_LEDGER = "docs/prospecting/import-manifests/gta-prospect-research-accepted-001-009.dry-run.json";
const FIXTURE_PATH = "src/app/admin/prospects/reconciled-prospects.ts";
const LEGACY_PATH = "src/app/admin/prospects/prospects-content.ts";
type Raw = Record<string, unknown>;
const object = (v: unknown): Raw => v && typeof v === "object" ? v as Raw : {};
const objects = (v: unknown): Raw[] => Array.isArray(v) ? v.filter((x): x is Raw => Boolean(x) && typeof x === "object") : [];
const texts = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && Boolean(x)) : [];
const str = (v: unknown): string => typeof v === "string" ? v.trim() : "";

function committed(commit: string, path: string): Raw {
  return JSON.parse(execFileSync("git", ["show", `${commit}:${path}`], { cwd: process.cwd(), encoding: "utf8" })) as Raw;
}
function normalizeDomain(value: string): string {
  return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "");
}
function sha(path: string): string { return createHash("sha256").update(readFileSync(resolve(process.cwd(), path))).digest("hex"); }
function output(path: string, contents: string): void {
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== contents) throw new Error(`Generated artifact is stale: ${path}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents, "utf8");
}
function json(path: string, value: unknown): void { output(path, `${JSON.stringify(value, null, 2)}\n`); }

function offlineLedgerRecords(): readonly ReconciledGtaProspect[] {
  const raw = JSON.parse(readFileSync(resolve(process.cwd(), OFFLINE_LEDGER), "utf8")) as Raw;
  return objects(raw.importRecords).map((record) => {
    const roster = object(record.roster);
    return {
      id: `offline-import:${str(record.sourceRecordKey)}`, recordOrigin: "shared_registry", canonicalDomain: str(record.websiteUrl) || str(roster.sourceUrl),
      firmName: str(record.firmName), city: str(record.city), officeCities: texts(record.officeCities), websiteUrl: str(record.websiteUrl) || null,
      practiceAreas: texts(record.practiceAreas), observedLawyerCount: Number(roster.lawyerCount),
      observedLawyerCountQualifier: roster.qualifier === "at_least" ? "at_least" : roster.qualifier === "unknown" ? "unknown" : "exact",
      observedLawyerCountDisplay: str(roster.display) || null, rosterSourceUrl: str(roster.sourceUrl), rosterCheckedAt: str(roster.observedOn),
      reconciliationStatus: "provisional_new", legacyClusterLawyerCount: null, legacyCrosswalk: null,
      reconciliationNote: "Offline accepted-ledger projection; live ledger not queried.", advertisingEvidence: "unknown", advertisingSourceUrl: null, gbpEvidence: "unknown", gbpSourceUrl: null,
    };
  });
}

function evidence(kind: GtaProspectBatch012Evidence["kind"], url: string, observed: string, value: unknown, note: string | null): GtaProspectBatch012Evidence {
  return { kind, url, observed_on: observed, status: value === null || (Array.isArray(value) && value.length === 0) ? "unknown" : "observed", value, note };
}

function comparisonStreet(published: string, city: string): string | null {
  let primary = published.split(";")[0].replace(new RegExp(`^${city}:\\s*`, "i"), "").trim();
  const cityIndex = primary.toLowerCase().lastIndexOf(`, ${city.toLowerCase()}`);
  if (cityIndex > 0) primary = primary.slice(0, cityIndex);
  if (/^(?:suite|unit|ste\.?|#)\s*#?\s*[a-z0-9]+\s*,/i.test(primary) && primary.split(",").length > 2) {
    const parts = primary.split(",").map((part) => part.trim());
    primary = `${parts[0]}, ${parts.at(-1)}`;
  }
  return normalizeProspectStreetAddress(primary);
}

function comparisonInput(normalized: string | null | undefined): string | undefined {
  const match = normalized?.match(/^unit=([^;]*);street=(.*)$/);
  if (!match) return undefined;
  return match[1] ? `${match[1]}-${match[2]}` : match[2];
}

function relationship(value: string): GtaProspectBatch012Leadership["relationship"] {
  const normalized = value.toLowerCase().replace(/\s+/g, "_");
  if (normalized.includes("owner")) return "owner";
  if (normalized.includes("founder")) return "founder";
  if (normalized.includes("managing") && normalized.includes("partner")) return "managing_partner";
  if (normalized.includes("partner")) return "partner";
  return "other_leadership";
}

function westRecord(raw: Raw, baseline: readonly ProspectBaselineRecord[]): GtaProspectBatch012Record {
  const id = str(raw.record_id); const office = object(raw.office); const observed = str(raw.observed_on);
  const cities = texts(office.cities); const published = str(office.published_address); const officeUrl = str(office.source_url);
  const rosterUrl = str(raw.roster_source_url); const relation = object(raw.relationship); const email = object(raw.published_email);
  const addresses: GtaProspectBatch012OfficeAddress[] = published ? [{ city: cities[0], published_address: published, comparison_street_address: comparisonStreet(published, cities[0]), url: officeUrl, observed_on: observed }] : [];
  const leaders: GtaProspectBatch012Leadership[] = str(relation.name) && str(relation.source_title) ? [{ name: str(relation.name), published_title: str(relation.source_title), relationship: relationship(str(relation.normalized_title) || str(relation.source_title)), url: str(relation.source_url), observed_on: observed }] : [];
  const emails: GtaProspectBatch012PublicEmail[] = str(email.value) ? [{ email: str(email.value), label: "published firm email", url: str(email.source_url), observed_on: observed }] : [];
  const qualifier = raw.count_qualifier === "exact" || raw.count_qualifier === "at_least" ? raw.count_qualifier : "unknown";
  const count = qualifier === "unknown" ? null : Number(raw.observed_lawyer_count);
  const review = reconcileProspectCandidateAgainstBaseline({ candidateId: id, firmName: str(raw.firm_name), canonicalDomain: str(raw.canonical_domain), streetAddress: comparisonInput(addresses[0]?.comparison_street_address), city: cities[0] }, baseline);
  const sourceDisposition = str(raw.screen_status);
  const stage = sourceDisposition === "candidate_exact_public_roster" ? "source_queue" : "held";
  const practices = texts(raw.practice_labels_published); const leadershipUrl = str(relation.source_url) || rosterUrl || officeUrl; const emailUrl = str(email.source_url) || officeUrl || rosterUrl;
  return {
    record_id: id, source: { lane: "west-north", source_commit: WEST_COMMIT, source_record_id: id }, stage, accepted: false, import_ready: false,
    firm_name: str(raw.firm_name), identity_aliases: [], canonical_domain: normalizeDomain(str(raw.canonical_domain)), office_cities: cities, office_addresses: addresses,
    observed_lawyer_count: count, count_qualifier: qualifier, roster_scope: str(raw.evidence_note) || null, practice_areas_published: practices,
    leadership: leaders, public_emails: emails, observed_on: observed, access_review: str(raw.access_review), source_disposition: sourceDisposition,
    hold_reason: stage === "held" ? sourceDisposition : null,
    evidence: [
      evidence("roster", rosterUrl, observed, qualifier === "unknown" ? null : { observed_lawyer_count: count, count_qualifier: qualifier, rationale: str(raw.evidence_note) }, qualifier === "unknown" ? str(raw.evidence_note) : null),
      evidence("office", officeUrl || rosterUrl, observed, addresses.length ? addresses : null, addresses.length ? null : "No first-party street address retained."),
      evidence("practice", rosterUrl || officeUrl, observed, practices.length ? practices : null, practices.length ? null : "No first-party practice labels retained."),
      evidence("relationship", leadershipUrl, observed, leaders.length ? leaders : null, leaders.length ? "Published title preserved without authority inference." : str(relation.note) || "Leadership unknown."),
      evidence("public_email", emailUrl, observed, emails.length ? emails : null, emails.length ? "Visibly published first-party email; no pattern inference." : "Public email unknown."),
    ],
    reconciliation: { state: review.state, automatic_merge: false, guard: "gta-prospect-baseline-reconciliation", loaded_sources: ["fixture", "ledger_projection", "legacy_source"], static_baseline_count: 6025, live_ledger_state: "offline_pending", matches: review.matches.map((match) => ({ origin: match.origin, record_id: match.recordId, fields: match.fields })), cross_lane_counterpart: null },
  };
}

function eastRecord(raw: Raw, baseline: readonly ProspectBaselineRecord[]): GtaProspectBatch012Record {
  const id = str(raw.record_id); const observed = str(raw.observed_on); const cities = texts(raw.office_cities);
  const addresses: GtaProspectBatch012OfficeAddress[] = objects(raw.office_address_evidence).map((item) => ({ city: str(item.city), published_address: str(item.street_address), comparison_street_address: comparisonStreet(str(item.street_address), str(item.city)), url: str(item.source_url), observed_on: str(item.observed_on) || observed }));
  const leaders: GtaProspectBatch012Leadership[] = objects(raw.leadership_evidence).map((item) => ({ name: str(item.name), published_title: str(item.title), relationship: relationship(str(item.title)), url: str(item.source_url), observed_on: str(item.observed_on) || observed }));
  const emails: GtaProspectBatch012PublicEmail[] = objects(raw.published_email_evidence).map((item) => ({ email: str(item.email), label: str(item.label), url: str(item.source_url), observed_on: str(item.observed_on) || observed }));
  const qualifier = raw.count_qualifier === "exact" || raw.count_qualifier === "at_least" ? raw.count_qualifier : "unknown";
  const count = qualifier === "unknown" ? null : Number(raw.observed_lawyer_count); const rosterUrl = str(raw.first_party_roster_url); const officeUrl = str(raw.office_source_url) || rosterUrl; const practiceUrl = str(raw.practice_source_url) || rosterUrl || officeUrl;
  const practices = texts(raw.practice_areas_published); const review = reconcileProspectCandidateAgainstBaseline({ candidateId: id, firmName: str(raw.firm_name), canonicalDomain: str(raw.canonical_domain), streetAddress: addresses[0]?.published_address, city: addresses[0]?.city || cities[0] }, baseline);
  const stage = raw.stage === "source_queue" ? "source_queue" : "held";
  return {
    record_id: id, source: { lane: "east-outer", source_commit: EAST_COMMIT, source_record_id: id }, stage, accepted: false, import_ready: false,
    firm_name: str(raw.firm_name), identity_aliases: texts(raw.identity_aliases), canonical_domain: normalizeDomain(str(raw.canonical_domain)), office_cities: cities, office_addresses: addresses,
    observed_lawyer_count: count, count_qualifier: qualifier, roster_scope: str(raw.roster_scope) || null, practice_areas_published: practices, leadership: leaders, public_emails: emails,
    observed_on: observed, access_review: str(raw.access_review), source_disposition: str(raw.workflow_status), hold_reason: stage === "held" ? str(raw.hold_reason) || str(raw.workflow_status) : null,
    evidence: [
      evidence("roster", rosterUrl, observed, qualifier === "unknown" ? null : { observed_lawyer_count: count, count_qualifier: qualifier, rationale: str(raw.counting_rationale) }, qualifier === "unknown" ? str(raw.counting_rationale) : null),
      evidence("office", officeUrl, observed, addresses.length ? addresses : null, addresses.length ? null : str(raw.office_address_unknown) || "No first-party street address retained."),
      evidence("practice", practiceUrl, observed, practices.length ? practices : null, practices.length ? null : "No first-party practice labels retained."),
      evidence("relationship", leaders[0]?.url || rosterUrl || officeUrl, observed, leaders.length ? leaders : null, leaders.length ? "Published title preserved without authority inference." : "Leadership unknown."),
      evidence("public_email", emails[0]?.url || officeUrl || rosterUrl, observed, emails.length ? emails : null, emails.length ? "Visibly published first-party email; no pattern inference." : "Public email unknown."),
    ],
    reconciliation: { state: review.state, automatic_merge: false, guard: "gta-prospect-baseline-reconciliation", loaded_sources: ["fixture", "ledger_projection", "legacy_source"], static_baseline_count: 6025, live_ledger_state: "offline_pending", matches: review.matches.map((match) => ({ origin: match.origin, record_id: match.recordId, fields: match.fields })), cross_lane_counterpart: null },
  };
}

function sourceRecords(commit: string, lane: string): Raw[] {
  return objects(committed(commit, `docs/research/gta-prospect-batch-012/lanes/${lane}.json`).records);
}

const offline = offlineLedgerRecords();
const legacy = legacyGtaSourceRecords();
const baseline = buildOperatorProspectBaseline({ fixtures: RECONCILED_GTA_PROSPECTS, ledgerProjection: offline, legacySource: legacy });
if (RECONCILED_GTA_PROSPECTS.length !== 20 || offline.length !== 103 || legacy.length !== 5902 || baseline.length !== 6025) throw new Error("Static baseline is not the expected complete 6,025-record set.");
const westRaw = sourceRecords(WEST_COMMIT, "west-north"); const eastRaw = sourceRecords(EAST_COMMIT, "east-outer");
const west: GtaProspectBatch012Document = { schema_version: GTA_PROSPECT_BATCH_012_SCHEMA_VERSION, batch_id: BATCH_ID, lane: "west-north", records: westRaw.map((record) => westRecord(record, baseline)) };
const east: GtaProspectBatch012Document = { schema_version: GTA_PROSPECT_BATCH_012_SCHEMA_VERSION, batch_id: BATCH_ID, lane: "east-outer", records: eastRaw.map((record) => eastRecord(record, baseline)) };
const documents = [west, east] as const; documents.forEach(validateGtaProspectBatch012Document);
const summary = deriveGtaProspectBatch012Summary(documents);
json(resolve(ROOT, "lanes/west-north.json"), west); json(resolve(ROOT, "lanes/east-outer.json"), east);
json(resolve(ROOT, "gta-prospect-batch-012.json"), { schema_version: GTA_PROSPECT_BATCH_012_SCHEMA_VERSION, batch_id: BATCH_ID, stage: "research_only", accepted: false, import_ready: false, automatic_merge: false, source_commits: { "west-north": WEST_COMMIT, "east-outer": EAST_COMMIT }, normalizer_commit: NORMALIZER_COMMIT, lane_files: ["lanes/west-north.json", "lanes/east-outer.json"], ...summary, baseline: { fixture_records: 20, offline_ledger_records: 103, legacy_source_records: 5902, total_static_records: 6025, live_ledger_state: "offline_pending" } });
const results = documents.flatMap((document) => document.records.map((record) => ({ candidate_id: record.record_id, lane: document.lane, state: record.reconciliation.state, automatic_merge: false, matches: record.reconciliation.matches })));
json(resolve(RECON_ROOT, "baseline-reconciliation.static.json"), { schema_version: "gta-prospect-baseline-reconciliation-v1", batch_id: BATCH_ID, normalizer: { commit: NORMALIZER_COMMIT, module: "src/lib/gta-prospect-baseline-reconciliation.ts", contract: "exact normalized domain/name and suite-preserving street address with city gate; no fuzzy match" }, baseline: { fixtures: { count: 20, path: FIXTURE_PATH, sha256: sha(FIXTURE_PATH) }, offline_ledger: { count: 103, path: OFFLINE_LEDGER, sha256: sha(OFFLINE_LEDGER) }, legacy_source: { count: 5902, path: LEGACY_PATH, sha256: sha(LEGACY_PATH) }, total: 6025 }, live_ledger_state: "offline_pending", automatic_merge: false, disposition_summary: summary, results });
const readme = `# GTA public-roster prospect Batch 012\n\nThis is a deterministic, read-only public-evidence source queue observed on **2026-09-08**. It contains ${summary.raw_record_count} records across west/north and east/outer GTA. Every record remains \`accepted=false\`, \`import_ready=false\`, and \`automatic_merge=false\`.\n\nThe generator reconciles against the complete repository baseline: 20 reviewed fixtures, 103 offline accepted-ledger projections, and 5,902 preserved legacy rows (${summary.static_review_required_count} review signals). The live ledger is \`offline_pending\`; a static clear result is not import approval.\n\nPublished office addresses retain suite/unit identity. Leadership names/titles and public emails are stored only when explicitly visible on the cited first-party page; unknowns remain unknown. No outreach, forms, chats, login, CRM write, import, merge, or deployment occurred.\n\nRegenerate with \`npm run prospects:generate-batch-012\` and verify with \`npm run prospects:validate-batch-012\`.\n`;
output(resolve(ROOT, "README.md"), readme);
output(resolve(RECON_ROOT, "README.md"), `# Batch 012 static baseline reconciliation\n\n- Records: ${summary.raw_record_count}\n- Static baseline: 6,025\n- Clear: ${summary.static_clear_count}\n- Review required: ${summary.static_review_required_count}\n- Cross-lane duplicate domains: ${summary.cross_lane_duplicate_domains.length}\n- Live ledger: \`offline_pending\`\n- Automatic merge: \`false\`\n- Accepted/import-ready: 0/0\n`);
console.log(process.argv.includes("--check") ? "Batch 012 artifacts are current." : "Generated Batch 012 artifacts.");
