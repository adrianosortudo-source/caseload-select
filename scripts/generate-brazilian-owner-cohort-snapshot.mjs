import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OWNER_CODES = new Set(["O1", "O2", "O3", "O4", "O5"]);
const RESEARCH_ELIGIBILITY = new Set(["primary_owner_cohort", "secondary_owner_cohort", "hold_owner_authority_review", "excluded_non_buyer", "do_not_contact"]);
const RESEARCH_STATES = new Set(["candidate", "screened", "eligible", "invited", "booked", "completed", "coded", "evidence_reviewed", "pilot_candidate", "excluded", "suppressed"]);
const INTERVIEW_STATES = new Set(["not_started", "invited", "booked", "completed", "coded", "declined", "unreachable"]);
const CONFIDENCE = new Set(["unreviewed", "single_source", "corroborated", "conflicting"]);
const DOMAIN_STATES = new Set(["current_primary", "professional_profile", "contact_source", "regulator", "directory", "historic", "unresolved"]);

const value = (row, camel, snake) => row[camel] ?? row[snake];
const slug = (text) => text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const required = (row, camel, snake = camel) => {
  const found = value(row, camel, snake);
  if (found === undefined || found === null || found === "") throw new Error(`Missing required field ${snake}`);
  return found;
};
const expectAllowed = (label, found, allowed) => {
  if (!allowed.has(found)) throw new Error(`Invalid ${label}: ${found}`);
  return found;
};
const stringList = (found, label) => {
  if (!Array.isArray(found) || found.some((item) => typeof item !== "string")) throw new Error(`${label} must be a string array`);
  return found;
};

function normalizeDomains(row) {
  const domains = value(row, "domainRelationships", "domain_relationships") ?? [];
  if (!Array.isArray(domains)) throw new Error("domain_relationships must be an array");
  return domains.map((relationship) => {
    const url = required(relationship, "url");
    const host = value(relationship, "host", "host") ?? new URL(url).hostname.replace(/^www\./, "");
    const state = expectAllowed("domain relationship state", required(relationship, "state"), DOMAIN_STATES);
    const confidence = expectAllowed("domain confidence", required(relationship, "confidence"), CONFIDENCE);
    return { url, host, state, confidence };
  });
}

function normalizeContactProvenance(row) {
  const entries = value(row, "contactSourceProvenance", "contact_source_provenance") ?? [];
  if (!Array.isArray(entries)) throw new Error("contact_source_provenance must be an array");
  return entries.map((entry) => {
    const field = required(entry, "field");
    if (!["email", "phone", "website"].includes(field)) throw new Error(`Invalid contact field: ${field}`);
    return {
      field,
      value: required(entry, "value"),
      sourceUrl: value(entry, "sourceUrl", "source_url") ?? null,
      evidenceIds: stringList(value(entry, "evidenceIds", "evidence_ids") ?? [], "evidence_ids"),
      confidence: expectAllowed("contact confidence", required(entry, "confidence"), CONFIDENCE),
    };
  });
}

function normalizeCohortFields(row) {
  return {
    canonicalPersonId: required(row, "canonicalPersonId", "canonical_person_id"),
    canonicalFirmId: required(row, "canonicalFirmId", "canonical_firm_id"),
    ownerAuthority: expectAllowed("owner authority", required(row, "ownerAuthority", "owner_authority"), OWNER_CODES),
    ownerAuthorityEvidence: stringList(value(row, "ownerAuthorityEvidence", "owner_authority_evidence") ?? [], "owner_authority_evidence"),
    researchEligibility: expectAllowed("research eligibility", required(row, "researchEligibility", "research_eligibility"), RESEARCH_ELIGIBILITY),
    researchState: expectAllowed("research state", required(row, "researchState", "research_state"), RESEARCH_STATES),
    interviewState: expectAllowed("interview state", required(row, "interviewState", "interview_state"), INTERVIEW_STATES),
    evidenceConfidence: expectAllowed("evidence confidence", required(row, "evidenceConfidence", "evidence_confidence"), CONFIDENCE),
    domainRelationships: normalizeDomains(row),
    contactSourceProvenance: normalizeContactProvenance(row),
    explicitUnknowns: stringList(value(row, "explicitUnknowns", "explicit_unknowns") ?? [], "explicit_unknowns"),
  };
}

function normalizePublicContact(contact) {
  if (!contact) return undefined;
  return {
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    website: contact.website ?? null,
    bioUrl: value(contact, "bioUrl", "bio_url") ?? null,
    contactSourceUrl: value(contact, "contactSourceUrl", "contact_source_url") ?? null,
    lsoSourceUrl: value(contact, "lsoSourceUrl", "lso_source_url") ?? null,
    provenance: stringList(contact.provenance ?? [], "public_contact.provenance"),
    lsoNumber: value(contact, "lsoNumber", "lso_number") ?? null,
    practiceAreas: stringList(value(contact, "practiceAreas", "practice_areas") ?? [], "public_contact.practice_areas"),
    status: contact.status ?? null,
    role: contact.role ?? null,
    suppressionReason: value(contact, "suppressionReason", "suppression_reason") ?? null,
  };
}

function uniqueStrings(values) {
  return [...new Set(values.filter((item) => typeof item === "string" && item.trim()))];
}

function cleanContactValue(found) {
  if (typeof found !== "string") return null;
  const trimmed = found.trim();
  return !trimmed || trimmed === "—" || trimmed.toLowerCase() === "unknown" ? null : trimmed;
}

function verifiedLaneDomainRelationships(row) {
  const relationships = new Map();
  const add = (url, state) => {
    if (!url || relationships.has(url)) return;
    relationships.set(url, { url, host: new URL(url).hostname.replace(/^www\./, ""), state, confidence: "corroborated" });
  };
  add(row.firm_website, "current_primary");
  add(row.person_bio_url, "professional_profile");
  add(row.lso_profile_url, "regulator");
  for (const url of row.evidence_urls ?? []) add(url, "unresolved");
  return [...relationships.values()];
}

function normalizeVerifiedLaneRow(row, existingPersonIds) {
  const canonicalPersonId = required(row, "person_id");
  const name = required(row, "name");
  const firm = required(row, "firm");
  const ownerAuthority = expectAllowed("owner authority", required(row, "owner_class"), OWNER_CODES);
  const evidence = required(row, "b_class");
  const eligibleOwner = row.eligibility === "verified_owner_operator";
  const researchEligibility = eligibleOwner
    ? evidence === "B4" ? "secondary_owner_cohort" : "primary_owner_cohort"
    : "hold_owner_authority_review";
  const evidenceUrls = stringList(row.evidence_urls ?? [], "evidence_urls");
  const provenance = typeof row.provenance === "string" ? [row.provenance] : stringList(row.provenance ?? [], "provenance");
  const explicitUnknowns = uniqueStrings([...(row.unknowns ?? []), ...(row.contradictions ?? [])]);
  const contactSource = row.person_bio_url ?? row.firm_website ?? null;
  const email = cleanContactValue(row.public_business_email);
  const phone = cleanContactValue(row.public_business_phone);
  const website = cleanContactValue(row.firm_website);
  const domainRelationships = verifiedLaneDomainRelationships(row);
  const contactSourceProvenance = [
    website ? { field: "website", value: website, sourceUrl: website, evidenceIds: evidenceUrls, confidence: "corroborated" } : null,
    email ? { field: "email", value: email, sourceUrl: contactSource, evidenceIds: evidenceUrls, confidence: "corroborated" } : null,
    phone ? { field: "phone", value: phone, sourceUrl: contactSource, evidenceIds: evidenceUrls, confidence: "corroborated" } : null,
  ].filter(Boolean);
  const common = {
    operation: existingPersonIds.has(canonicalPersonId) ? "update" : "add",
    id: slug(name),
    name,
    firm,
    bucket: evidence === "B4" ? "portuguese" : "explicit",
    researchSet: evidence === "B4" ? "portuguese_only_brazil_unconfirmed" : "brazil_connected_ready",
    outreachEligibility: "INTERNAL_CANDIDATE_UNSENT",
    currentPrimaryFirm: firm,
    suppression: null,
    evidence,
    website: website ?? undefined,
    email: email ?? undefined,
    phone: phone ?? undefined,
    sources: evidenceUrls,
    unknowns: explicitUnknowns,
    domains: evidenceUrls,
    sourceRecordId: canonicalPersonId,
    publicContact: {
      email,
      phone,
      website,
      bioUrl: row.person_bio_url ?? null,
      contactSourceUrl: contactSource,
      lsoSourceUrl: row.lso_profile_url ?? null,
      provenance,
      lsoNumber: row.lso_number ?? null,
      practiceAreas: [],
      status: row.current_affiliation_status ?? null,
      role: null,
      suppressionReason: null,
    },
    canonicalPersonId,
    canonicalFirmId: `firm:${slug(firm)}`,
    ownerAuthority,
    ownerAuthorityEvidence: uniqueStrings([row.owner_basis, ...evidenceUrls]),
    researchEligibility,
    researchState: eligibleOwner ? "eligible" : "screened",
    interviewState: "not_started",
    evidenceConfidence: "corroborated",
    domainRelationships,
    contactSourceProvenance,
    explicitUnknowns,
  };
  return common;
}

export function normalizeOwnerCohortRows(rows, options = {}) {
  const existingPersonIds = options.existingPersonIds ?? new Set();
  const normalized = rows.map((row) => {
    if (!row.operation && row.owner_class) return normalizeVerifiedLaneRow(row, existingPersonIds);
    const operation = required(row, "operation");
    if (operation !== "update" && operation !== "add") throw new Error(`Invalid operation: ${operation}`);
    const common = { operation, id: required(row, "id"), ...normalizeCohortFields(row) };
    if (operation === "update") return common;

    const addition = {
      ...common,
      name: required(row, "name"),
      firm: required(row, "firm"),
      bucket: required(row, "bucket"),
      researchSet: required(row, "researchSet", "research_set"),
      currentPrimaryFirm: value(row, "currentPrimaryFirm", "current_primary_firm") ?? null,
      suppression: row.suppression ?? null,
      evidence: required(row, "evidence"),
      sources: stringList(row.sources ?? [], "sources"),
      unknowns: stringList(row.unknowns ?? [], "unknowns"),
    };
    for (const [camel, snake] of [["outreachEligibility", "outreach_eligibility"], ["website", "website"], ["email", "email"], ["phone", "phone"], ["sourceRecordId", "source_record_id"], ["note", "note"]]) {
      const found = value(row, camel, snake);
      if (found !== undefined && found !== null) addition[camel] = found;
    }
    const domains = value(row, "domains", "domains");
    if (domains) addition.domains = stringList(domains, "domains");
    const publicContact = normalizePublicContact(value(row, "publicContact", "public_contact"));
    if (publicContact) addition.publicContact = publicContact;
    const connection = value(row, "portugueseBrazilConnection", "portuguese_brazil_connection");
    if (connection) addition.portugueseBrazilConnection = {
      category: required(connection, "category"),
      evidenceSource: required(connection, "evidenceSource", "evidence_source"),
      statement: required(connection, "statement"),
    };
    return addition;
  });

  normalized.sort((left, right) => left.canonicalPersonId.localeCompare(right.canonicalPersonId));
  const ids = new Set();
  const personIds = new Set();
  for (const row of normalized) {
    if (ids.has(row.id)) throw new Error(`Duplicate record ID: ${row.id}`);
    if (personIds.has(row.canonicalPersonId)) throw new Error(`Duplicate canonical person: ${row.canonicalPersonId}`);
    ids.add(row.id);
    personIds.add(row.canonicalPersonId);
  }
  return normalized;
}

async function main() {
  const source = process.argv[2];
  if (!source) throw new Error("Usage: node scripts/generate-brazilian-owner-cohort-snapshot.mjs <approved-qa.jsonl> [destination.ts]");
  const destination = resolve(process.argv[3] ?? "src/lib/brazilian-owner-cohort.snapshot.ts");
  const raw = await readFile(resolve(source), "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  const contactSnapshot = await readFile(resolve("src/lib/brazilian-prospect-contacts.snapshot.ts"), "utf8");
  const snapshotMatch = contactSnapshot.match(/PUBLIC_CONTACT_SNAPSHOT = ([\s\S]+) as const;\s*$/);
  if (!snapshotMatch) throw new Error("Unable to parse the existing public-contact snapshot");
  const existingPersonIds = new Set(JSON.parse(snapshotMatch[1]).map((row) => row.personId));
  const normalized = normalizeOwnerCohortRows(lines.map((line) => JSON.parse(line)), { existingPersonIds });
  const manifest = {
    rows: normalized.length,
    sha256: createHash("sha256").update(raw).digest("hex").toUpperCase(),
    sourceFile: resolve(source).split(/[\\/]/).at(-1),
  };
  const output = `import type { ProspectOwnerCohortUpdate } from "./prospect-intelligence";\n\n// Generated from a Luna-approved owner-cohort QA dataset; do not hand edit.\nexport const BRAZILIAN_OWNER_COHORT_SOURCE_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const;\n\nexport const BRAZILIAN_OWNER_COHORT_UPDATES = ${JSON.stringify(normalized, null, 2)} as const satisfies readonly ProspectOwnerCohortUpdate[];\n`;
  await writeFile(destination, output);
  console.log(`Wrote ${normalized.length} owner-cohort updates to ${destination}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
