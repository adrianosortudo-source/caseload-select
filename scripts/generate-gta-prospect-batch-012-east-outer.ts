import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { RECONCILED_GTA_PROSPECTS } from "../src/app/admin/prospects/reconciled-prospects";
import { legacyGtaSourceRecords } from "../src/lib/legacy-gta-prospect-source";

const SOURCE_COMMIT = "433c93bb9b18a35f3647c882eda95c57d8508f67";
const NORMALIZER_COMMIT = "337b5cf7";
const LANE_PATH = "docs/research/gta-prospect-batch-012/lanes/east-outer.json";
const LANE_README_PATH = "docs/research/gta-prospect-batch-012/lanes/east-outer.md";
const RECONCILIATION_JSON_PATH = "docs/reconciliation/gta-prospect-batch-012/east-outer-static-reconciliation.json";
const RECONCILIATION_MD_PATH = "docs/reconciliation/gta-prospect-batch-012/east-outer-static-reconciliation.md";
const OFFLINE_LEDGER_PATH = "docs/prospecting/import-manifests/gta-prospect-research-accepted-001-009.dry-run.json";
const FIXTURE_PATH = "src/app/admin/prospects/reconciled-prospects.ts";
const LEGACY_PATH = "src/app/admin/prospects/prospects-content.ts";
const OBSERVED_ON = "2026-09-08";

type JsonRecord = Record<string, unknown>;
type BaselineOrigin = "fixture" | "ledger_projection" | "legacy_source";
type BaselineRecord = {
  origin: BaselineOrigin;
  recordId: string;
  firmName: string;
  canonicalDomain?: string | null;
  streetAddress?: string | null;
  city?: string | null;
};

type Match = {
  origin: BaselineOrigin;
  record_id: string;
  fields: ("canonical_domain" | "firm_name" | "street_address")[];
};

const asString = (value: unknown): string => typeof value === "string" ? value : "";
const asStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const asRecords = (value: unknown): JsonRecord[] => Array.isArray(value) ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
const isoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

function httpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function normalizeDomain(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password || parsed.port) return null;
    return parsed.hostname.toLocaleLowerCase("en-CA").replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

const LEGAL_SUFFIX = /(?:\s+(?:llp|l\s+l\s+p|llc|l\s+l\s+c|ltd|limited|inc|pc|p\s+c|professional\s+corporation|law\s+corporation|corporation))+$/;

function normalizeFirmName(value: string | null | undefined): string | null {
  const compact = value
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-CA")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!compact) return null;
  return compact.replace(LEGAL_SUFFIX, "").trim() || null;
}

function normalizeAddressWords(value: string): string {
  const aliases: Record<string, string> = {
    ave: "avenue", blvd: "boulevard", dr: "drive", e: "east", hwy: "highway",
    n: "north", rd: "road", s: "south", st: "street", w: "west",
  };
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => aliases[word] ?? word)
    .join(" ");
}

/** Kept byte-for-byte equivalent to the corrected suite-safe contract at NORMALIZER_COMMIT. */
function normalizeStreetAddress(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  let unit: string | null = null;
  let remainder = raw;
  const namedUnit = raw.match(/^\s*(?:suite|unit|ste\.?|#)\s*#?\s*([a-z0-9]+)\s*(?:[,\-]\s*|\s+)(.+)$/i);
  const hyphenatedUnit = raw.match(/^\s*([a-z0-9]+)\s*-\s*(\d+[a-z0-9\s.,'-]*)$/i);
  const trailingNamedUnit = raw.match(/^\s*(.+?)\s*,?\s+(?:suite|unit|ste\.?|#)\s*#?\s*([a-z0-9]+)\s*$/i);
  if (namedUnit) {
    unit = namedUnit[1];
    remainder = namedUnit[2];
  } else if (hyphenatedUnit) {
    unit = hyphenatedUnit[1];
    remainder = hyphenatedUnit[2];
  } else if (trailingNamedUnit) {
    remainder = trailingNamedUnit[1];
    unit = trailingNamedUnit[2];
  }
  const normalizedRemainder = normalizeAddressWords(remainder);
  if (!normalizedRemainder) return null;
  return `unit=${unit ? normalizeAddressWords(unit) : ""};street=${normalizedRemainder}`;
}

const normalizeCity = (value: string | null | undefined): string | null => normalizeAddressWords(value ?? "") || null;

function reconcile(candidate: { id: string; firmName: string; domain: string; address?: string; city?: string }, baseline: BaselineRecord[]) {
  const candidateName = normalizeFirmName(candidate.firmName);
  const candidateDomain = normalizeDomain(candidate.domain);
  const candidateAddress = normalizeStreetAddress(candidate.address);
  const candidateCity = normalizeCity(candidate.city);
  const matches = baseline.flatMap((record): Match[] => {
    const fields: Match["fields"] = [];
    if (candidateDomain && normalizeDomain(record.canonicalDomain) === candidateDomain) fields.push("canonical_domain");
    if (candidateName && normalizeFirmName(record.firmName) === candidateName) fields.push("firm_name");
    const address = normalizeStreetAddress(record.streetAddress);
    const city = normalizeCity(record.city);
    if (candidateAddress && address === candidateAddress && (!candidateCity || !city || candidateCity === city)) fields.push("street_address");
    return fields.length ? [{ origin: record.origin, record_id: record.recordId, fields: fields.sort() }] : [];
  }).sort((left, right) => left.origin.localeCompare(right.origin, "en-CA") || left.record_id.localeCompare(right.record_id, "en-CA"));
  return { candidate_id: candidate.id, state: matches.length ? "review_required" : "clear", automatic_merge: false, matches };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(resolve(process.cwd(), path))).digest("hex");
}

function originalDocument(): JsonRecord {
  return JSON.parse(execFileSync("git", ["show", `${SOURCE_COMMIT}:${LANE_PATH}`], { cwd: process.cwd(), encoding: "utf8" })) as JsonRecord;
}

function offlineLedger(): BaselineRecord[] {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), OFFLINE_LEDGER_PATH), "utf8")) as JsonRecord;
  const records = asRecords(manifest.importRecords);
  return records.map((record) => {
    const roster = record.roster && typeof record.roster === "object" ? record.roster as JsonRecord : {};
    const sourceUrl = asString(roster.sourceUrl);
    return {
      origin: "ledger_projection" as const,
      recordId: `offline-import:${asString(record.sourceRecordKey)}`,
      firmName: asString(record.firmName),
      canonicalDomain: normalizeDomain(asString(record.websiteUrl)) ?? normalizeDomain(sourceUrl),
      city: asString(record.city),
    };
  });
}

function staticBaseline(): BaselineRecord[] {
  const fixtures: BaselineRecord[] = RECONCILED_GTA_PROSPECTS.map((record) => ({
    origin: "fixture",
    recordId: record.id,
    firmName: record.firmName,
    canonicalDomain: record.canonicalDomain ?? record.websiteUrl,
    city: record.city,
  }));
  const ledger = offlineLedger();
  const legacy: BaselineRecord[] = legacyGtaSourceRecords().map((record) => ({
    origin: "legacy_source",
    recordId: record.sourceRecordKey,
    firmName: record.candidate.displayName,
    canonicalDomain: record.candidate.candidateDomain,
    streetAddress: record.candidate.address,
    city: record.candidate.city,
  }));
  if (fixtures.length !== 20 || ledger.length !== 103 || legacy.length !== 5902) {
    throw new Error(`Unexpected baseline counts: fixture=${fixtures.length}, ledger=${ledger.length}, legacy=${legacy.length}`);
  }
  return [...fixtures, ...ledger, ...legacy];
}

function evidenceItem(kind: string, sourceUrl: string, status: "observed" | "unknown", value: unknown, note: string | null) {
  if (!httpsUrl(sourceUrl)) throw new Error(`${kind} evidence requires an HTTPS source URL.`);
  return { kind, source_url: sourceUrl, observed_on: OBSERVED_ON, status, value, note };
}

function canonicalRecord(raw: JsonRecord, baseline: BaselineRecord[]) {
  const id = asString(raw.record_id);
  const leaders = asRecords(raw.leadership_evidence).map((leader) => ({
    name: asString(leader.name),
    title: asString(leader.title),
    source_url: asString(leader.source_url),
    observed_on: asString(leader.observed_date) || OBSERVED_ON,
  }));
  const emails = asRecords(raw.published_email_evidence).map((email) => ({
    label: asString(email.label),
    email: asString(email.email),
    source_url: asString(email.source_url),
    observed_on: asString(email.observed_date) || OBSERVED_ON,
  }));
  const addresses = asRecords(raw.office_address_evidence).map((address) => ({
    city: asString(address.city),
    street_address: asString(address.street_address),
    source_url: asString(address.source_url),
    observed_on: asString(address.observed_date) || OBSERVED_ON,
  }));
  const countQualifier = raw.count_qualifier === "exact" || raw.count_qualifier === "at_least" ? raw.count_qualifier : "unknown";
  const lawyerCount = countQualifier === "unknown" ? null : typeof raw.observed_lawyer_count === "number" ? raw.observed_lawyer_count : null;
  const rosterUrl = asString(raw.first_party_roster_url);
  const officeUrl = asString(raw.office_source_url) || rosterUrl;
  const practices = asStrings(raw.practice_areas_published);
  const practiceUrl = rosterUrl || officeUrl;
  const relationshipUrl = leaders[0]?.source_url || rosterUrl || officeUrl;
  const emailUrl = emails[0]?.source_url || officeUrl || rosterUrl;
  const primaryAddress = addresses[0];
  const review = reconcile({
    id,
    firmName: asString(raw.firm_name),
    domain: asString(raw.canonical_domain),
    address: primaryAddress?.street_address,
    city: primaryAddress?.city || asStrings(raw.office_cities)[0],
  }, baseline);
  const workflow = asString(raw.workflow_status);
  const sourceQueueCandidate = workflow === "source_queue_candidate";
  return {
    record_id: id,
    workflow_status: workflow,
    stage: sourceQueueCandidate ? "source_queue" : "held",
    accepted: false,
    import_ready: false,
    firm_name: asString(raw.firm_name),
    canonical_domain: normalizeDomain(asString(raw.canonical_domain)),
    identity_aliases: asStrings(raw.identity_aliases),
    office_cities: asStrings(raw.office_cities),
    ...(asString(raw.office_scope_note) ? { office_scope_note: asString(raw.office_scope_note) } : {}),
    office_address_evidence: addresses,
    ...(asString(raw.office_address_unknown) ? { office_address_unknown: asString(raw.office_address_unknown) } : {}),
    observed_lawyer_count: lawyerCount,
    count_qualifier: countQualifier,
    lawyer_band: typeof raw.lawyer_band === "string" ? raw.lawyer_band : null,
    ...(asString(raw.roster_scope) ? { roster_scope: asString(raw.roster_scope) } : {}),
    first_party_roster_url: rosterUrl,
    office_source_url: officeUrl,
    practice_source_url: practiceUrl,
    practice_areas_published: practices,
    leadership_evidence: leaders,
    relationship_labels: leaders.map((leader) => leader.title),
    published_email_evidence: emails,
    observed_on: OBSERVED_ON,
    access_review: asString(raw.access_review),
    counting_rationale: asString(raw.counting_rationale),
    hold_reason: asString(raw.hold_reason),
    evidence: [
      evidenceItem("roster", rosterUrl, countQualifier === "unknown" ? "unknown" : "observed", {
        observed_lawyer_count: lawyerCount,
        count_qualifier: countQualifier,
        scope: asString(raw.roster_scope) || null,
        rationale: asString(raw.counting_rationale),
      }, countQualifier === "unknown" ? "The reviewed first-party page did not establish a bounded current lawyer count." : null),
      evidenceItem("office", officeUrl, addresses.length ? "observed" : "unknown", addresses.length ? addresses : null,
        addresses.length ? null : asString(raw.office_address_unknown) || "No office street address was observed on the reviewed first-party page."),
      evidenceItem("practice", practiceUrl, practices.length ? "observed" : "unknown", practices.length ? practices : null,
        practices.length ? null : "No bounded practice labels were retained from the reviewed first-party page."),
      evidenceItem("relationship", relationshipUrl, leaders.length ? "observed" : "unknown", leaders.length ? leaders : null,
        leaders.length ? "Names and titles are preserved exactly as published; no ownership or authority inference was added." : "No explicit owner, founder, managing partner, partner, or other leadership title was retained from the reviewed first-party page."),
      evidenceItem("public_email", emailUrl, emails.length ? "observed" : "unknown", emails.length ? emails : null,
        emails.length ? "Only visibly published first-party email evidence is retained; no address pattern was inferred." : "No visibly published named or general email was retained from the reviewed first-party page."),
    ],
    reconciliation: {
      state: review.state,
      automatic_merge: false,
      guard: "gta-prospect-baseline-reconciliation",
      normalizer_commit: NORMALIZER_COMMIT,
      loaded_sources: ["fixture", "ledger_projection", "legacy_source"],
      live_ledger_state: "offline_pending",
      matches: review.matches,
    },
  };
}

function validateDocument(document: JsonRecord): void {
  if (document.schema_version !== "2.0" || document.batch_id !== "gta-prospect-batch-012" || document.lane !== "EAST_OUTER") throw new Error("Unexpected canonical document identity.");
  const records = asRecords(document.records);
  if (records.length !== 20) throw new Error(`Expected 20 records, found ${records.length}.`);
  const ids = new Set<string>();
  for (const record of records) {
    const id = asString(record.record_id);
    if (!id || ids.has(id)) throw new Error(`Missing or duplicate record id: ${id}`);
    ids.add(id);
    if (record.accepted !== false || record.import_ready !== false) throw new Error(`${id} crosses the research-only gate.`);
    if (!isoDate(asString(record.observed_on))) throw new Error(`${id} has no record observation date.`);
    const reconciliation = record.reconciliation as JsonRecord;
    if (reconciliation.automatic_merge !== false || reconciliation.live_ledger_state !== "offline_pending") throw new Error(`${id} has an invalid reconciliation gate.`);
    const evidence = asRecords(record.evidence);
    const expectedKinds = ["office", "practice", "public_email", "relationship", "roster"];
    if (evidence.map((item) => asString(item.kind)).sort().join("|") !== expectedKinds.join("|")) throw new Error(`${id} lacks the five canonical evidence kinds.`);
    for (const item of evidence) {
      if (!httpsUrl(asString(item.source_url)) || asString(item.observed_on) !== record.observed_on) throw new Error(`${id} has an invalid evidence source/date pair.`);
    }
    for (const nested of [...asRecords(record.office_address_evidence), ...asRecords(record.leadership_evidence), ...asRecords(record.published_email_evidence)]) {
      if (!httpsUrl(asString(nested.source_url)) || asString(nested.observed_on) !== record.observed_on) throw new Error(`${id} has invalid nested evidence provenance.`);
    }
    const relationship = evidence.find((item) => item.kind === "relationship")!;
    const leaders = asRecords(record.leadership_evidence);
    if ((leaders.length > 0) !== (relationship.status === "observed")) throw new Error(`${id} has a contradictory relationship status.`);
    if (leaders.length && JSON.stringify(relationship.value) !== JSON.stringify(leaders)) throw new Error(`${id} does not preserve exact relationship labels.`);
  }
  if (JSON.stringify(normalizeStreetAddress("200-342 Queen St W")) === JSON.stringify(normalizeStreetAddress("100-342 Queen Street West"))) throw new Error("Suite-safe normalization regressed.");
  if (normalizeStreetAddress("Suite 204, 3100 Rutherford Road") !== normalizeStreetAddress("3100 Rutherford Road suite 204")) throw new Error("Trailing-suite normalization regressed.");
}

function render(): Record<string, string> {
  const source = originalDocument();
  const baseline = staticBaseline();
  const records = asRecords(source.records).map((record) => canonicalRecord(record, baseline));
  const candidates = records.filter((record) => record.stage === "source_queue");
  const held = records.filter((record) => record.stage === "held");
  const reviewRequired = records.filter((record) => record.reconciliation.state === "review_required");
  const clear = records.filter((record) => record.reconciliation.state === "clear");
  const canonical = {
    schema_version: "2.0",
    batch_id: "gta-prospect-batch-012",
    lane: "EAST_OUTER",
    observed_on: OBSERVED_ON,
    scope: source.scope,
    source_policy: source.source_policy,
    source_commit: SOURCE_COMMIT,
    normalizer: {
      contract_commit: NORMALIZER_COMMIT,
      rules: ["exact normalized canonical domain", "exact normalized firm name", "suite-preserving normalized street address with city gate", "no fuzzy matching", "no automatic merge"],
    },
    baseline: { fixtures: 20, offline_ledger: 103, legacy_source: 5902, total: baseline.length, live_ledger_state: "offline_pending" },
    disposition_summary: {
      records_screened: records.length,
      source_queue_candidates: candidates.length,
      held: held.length,
      review_required: reviewRequired.length,
      clear: clear.length,
      automatic_merge: 0,
      accepted: 0,
      import_ready: 0,
    },
    records,
  };
  validateDocument(canonical);

  const reconciliation = {
    schema_version: "gta-prospect-baseline-reconciliation-v1",
    batch_id: "gta-prospect-batch-012",
    lane: "EAST_OUTER",
    observed_on: OBSERVED_ON,
    normalizer: { module: "src/lib/gta-prospect-baseline-reconciliation.ts", fixed_commit: NORMALIZER_COMMIT, contract: "exact canonical-domain/name/street-address diagnostics; suite identity retained; no fuzzy matching" },
    baseline: {
      fixtures: { count: 20, source_path: FIXTURE_PATH, sha256: sha256(FIXTURE_PATH) },
      offline_ledger: { count: 103, source_path: OFFLINE_LEDGER_PATH, sha256: sha256(OFFLINE_LEDGER_PATH) },
      legacy_source: { count: 5902, source_path: LEGACY_PATH, sha256: sha256(LEGACY_PATH) },
      total: baseline.length,
    },
    live_ledger: "offline_pending",
    automatic_merge: false,
    disposition_summary: canonical.disposition_summary,
    candidate_results: records.map((record) => ({ candidate_id: record.record_id, ...record.reconciliation, guard: undefined, normalizer_commit: undefined, loaded_sources: undefined, live_ledger_state: undefined })),
  };

  const matchLines = reviewRequired.map((record) => `- ${record.record_id}: ${record.reconciliation.matches.map((match) => `${match.origin}:${match.record_id} [${match.fields.join(", ")}]`).join("; ")}`).join("\n");
  const heldClearLines = held.filter((record) => record.reconciliation.state === "clear").map((record) => `- ${record.record_id}: clear static baseline; original held disposition retained`).join("\n");
  const names = candidates.map((record) => record.firm_name).join(", ");
  const reconMd = `# Batch 012 EAST_OUTER static baseline reconciliation\n\nObservation date: ${OBSERVED_ON}\n\nNormalizer contract: \`src/lib/gta-prospect-baseline-reconciliation.ts\` at fixed commit \`${NORMALIZER_COMMIT}\`. Matching is deterministic exact normalized canonical domain, exact normalized firm name, and suite-preserving normalized street address with a city gate. No fuzzy matching or automatic merge is performed.\n\n## Offline baseline\n\n- Reviewed fixtures: 20\n- Offline accepted-ledger projection: 103\n- Historical legacy source: 5,902\n- Total baseline records: 6,025\n- Live ledger: \`offline_pending\`\n- Automatic merge: \`false\` for every result\n\n## Results\n\nSix exact source-queue candidates remain non-accepted: ${names}.\n\nSix records require review because the fixed normalizer found deterministic baseline matches:\n\n${matchLines}\n\nThe remaining held records have no deterministic baseline match but retain their original evidence, scope, or minimum-count disposition:\n\n${heldClearLines}\n\nNo record is accepted or import-ready. The live operator-ledger join remains pending.\n`;
  const laneMd = `# Batch 012 EAST_OUTER research\n\nObservation date: ${OBSERVED_ON}\n\n## Scope and method\n\nThis bounded source queue covers private-practice firms with a public first-party presence in Durham/east and approved outer-GTA municipalities. Discovery used public search. The canonical artifact retains five evidence types for every record: roster, office, practice, relationship, and public email. Every evidence item has an HTTPS source and \`observed_on\`; unknown evidence stays explicit. Published names and relationship titles are preserved exactly, without inferring owner, decision authority, or an email pattern.\n\nNo forms, chats, logins, outreach, ads, GBP, CRM, database, production import, or anti-bot bypass was used. Every record remains \`accepted: false\`, \`import_ready: false\`, and \`automatic_merge: false\`. The live ledger remains \`offline_pending\`.\n\n## Disposition\n\n- Records screened: 20\n- Exact source-queue candidates: 6\n- Held: 14\n- Static review required: 6\n- Static clear: 14\n- Accepted: 0\n- Import-ready: 0\n\nThe six source-queue candidates are ${names}. A clear static result is not an approval: independent review and the live-ledger check remain required before any separate staging decision.\n\n## Reconciliation controls\n\nThe reproducible static check compares all records with 20 reviewed fixtures, 103 offline accepted-ledger records, and 5,902 preserved legacy rows using the corrected suite-safe normalizer contract at \`${NORMALIZER_COMMIT}\`. It never performs fuzzy matching, survivor selection, or automatic merging. Run \`npx tsx scripts/generate-gta-prospect-batch-012-east-outer.ts --check\` to validate the committed artifacts.\n`;

  return {
    [LANE_PATH]: `${JSON.stringify(canonical, null, 2)}\n`,
    [LANE_README_PATH]: laneMd,
    [RECONCILIATION_JSON_PATH]: `${JSON.stringify(reconciliation, (_key, value) => value === undefined ? undefined : value, 2)}\n`,
    [RECONCILIATION_MD_PATH]: reconMd,
  };
}

for (const [relativePath, contents] of Object.entries(render())) {
  const path = resolve(process.cwd(), relativePath);
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== contents) throw new Error(`Generated artifact is stale: ${relativePath}`);
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, "utf8");
  }
}

console.log(process.argv.includes("--check") ? "Batch 012 EAST_OUTER artifacts are current." : "Generated Batch 012 EAST_OUTER artifacts.");
