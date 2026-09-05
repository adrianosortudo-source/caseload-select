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
  provenance: row.provenance ?? [], eligibility: row.outreach_eligibility, unknowns: row.unknowns ?? [], portugueseBrazilConnection: row.portuguese_brazil_connection ? { category: row.portuguese_brazil_connection.category, evidenceSource: row.portuguese_brazil_connection.evidence_url, statement: row.portuguese_brazil_connection.evidence_statement } : null,
  unknowns: row.unknowns ?? [],
  portugueseBrazilConnection: row.portuguese_brazil_connection ? {
    category: row.portuguese_brazil_connection.category,
    evidenceSource: row.portuguese_brazil_connection.evidence_url,
    statement: row.portuguese_brazil_connection.evidence_statement,
  } : null,
}));
await writeFile(destination, `// Generated from the public-contact reconciliation source; do not hand edit.\nexport const PUBLIC_CONTACT_SNAPSHOT = ${JSON.stringify(normalized, null, 2)} as const;\n`);
console.log(`Wrote ${normalized.length} public-contact records to ${destination}`);
