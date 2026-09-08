import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = "D:/00_Work/01_CaseLoad_Select/07_Prospects/Brazilian_Lawyers_Ontario_2026-09/contacts/LUNA_PUBLIC_CONTACTS_2026-09-03.jsonl";
const destination = resolve("src/lib/brazilian-prospect-contacts.snapshot.ts");
const rows = (await readFile(source, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
const normalized = rows.map((row) => ({
  personId: row.person_id, name: row.person_name, firm: row.firm, role: row.title, lsoNumber: row.lso_number ?? null, practiceAreas: row.practice_areas ?? [], status: row.current_affiliation_status ?? null, suppressionReason: row.suppression_reason ?? null,
  email: row.public_business_email?.value ?? null, phone: row.public_business_phone?.value ?? null,
  website: row.firm_website ?? null, bioUrl: row.person_bio_url ?? null,
  contactSourceUrl: row.contact_source_url ?? null, lsoSourceUrl: row.lso_source_url ?? null,
  provenance: row.provenance ?? [], eligibility: row.outreach_eligibility,
  unknowns: row.unknowns ?? [],
  portugueseBrazilConnection: row.portuguese_brazil_connection ? {
    category: row.portuguese_brazil_connection.category,
    evidenceSource: row.portuguese_brazil_connection.evidence_url,
    statement: row.portuguese_brazil_connection.evidence_statement,
  } : null,
  // Optional owner-research fields are intentionally null/empty until an
  // evidence-reviewed source supplies them. The application adapter retains
  // safe O4/hold/not-started defaults for older snapshots.
  ...(row.canonical_firm_id ? { canonicalFirmId: row.canonical_firm_id } : {}),
  ...(row.owner_authority ? { ownerAuthority: row.owner_authority } : {}),
  ...(row.owner_authority_evidence ? { ownerAuthorityEvidence: row.owner_authority_evidence } : {}),
  ...(row.research_eligibility ? { researchEligibility: row.research_eligibility } : {}),
  ...(row.research_state ? { researchState: row.research_state } : {}),
  ...(row.interview_state ? { interviewState: row.interview_state } : {}),
  ...(row.evidence_confidence ? { evidenceConfidence: row.evidence_confidence } : {}),
  ...(row.domain_relationships ? { domainRelationships: row.domain_relationships.map((relationship) => ({
    url: relationship.url,
    host: relationship.host,
    state: relationship.state,
    confidence: relationship.confidence,
  })) } : {}),
  ...(row.contact_source_provenance ? { contactSourceProvenance: row.contact_source_provenance.map((entry) => ({
    field: entry.field,
    value: entry.value,
    sourceUrl: entry.source_url ?? null,
    evidenceIds: entry.evidence_ids ?? [],
    confidence: entry.confidence,
  })) } : {}),
  ...(row.explicit_unknowns ? { explicitUnknowns: row.explicit_unknowns } : {}),
}));
await writeFile(destination, `// Generated from the public-contact reconciliation source; do not hand edit.\nexport const PUBLIC_CONTACT_SNAPSHOT = ${JSON.stringify(normalized, null, 2)} as const;\n`);
console.log(`Wrote ${normalized.length} public-contact records to ${destination}`);
