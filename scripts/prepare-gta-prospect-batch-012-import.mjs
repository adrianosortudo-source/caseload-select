import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const observedOn = "2026-09-10";
const root = resolve("docs/reconciliation/gta-prospect-batch-012");
const files = [
  "docs/research/gta-prospect-batch-012/lanes/west-north.json",
  "docs/research/gta-prospect-batch-012/lanes/east-outer.json",
];

const importDecisions = {
  "B012-WN-01": ["provisional_new", "No live, fixture, or legacy identity match."],
  "B012-WN-02": ["update_existing", "A legacy lawyer row shares the same published firm address; no live-ledger firm exists."],
  "B012-WN-03": ["provisional_new", "No live, fixture, or legacy identity match."],
  "B012-WN-04": ["provisional_new", "The legacy signals are differently named firms sharing the suite; neither is the candidate firm."],
  "B012-WN-05": ["update_existing", "The legacy D'Alessio row is a predecessor or related published firm identity at the same suite; no live-ledger firm exists."],
  "B012-WN-H01": ["provisional_new", "First-party roster, principal, office, and public inbox evidence identify a three-lawyer firm."],
  "B012-EAST-01": ["update_existing", "The legacy KELINY row shares the exact suite and firm identity; no live-ledger firm exists."],
  "B012-EAST-02": ["provisional_new", "No live, fixture, or legacy identity match."],
  "B012-EAST-03": ["provisional_new", "No live, fixture, or legacy identity match."],
  "B012-EAST-04": ["provisional_new", "No live, fixture, or legacy identity match."],
  "B012-EAST-05": ["provisional_new", "No live, fixture, or legacy identity match."],
  "B012-EAST-06": ["provisional_new", "The site discloses a relationship with Devry Smith Frank, while Woitzik Polsinelli remains a separately published firm identity."],
  "B012-EAST-07": ["provisional_new", "The current first-party roster identifies nine lawyers; ownership and public email remain unknown."],
  "B012-EAST-17": ["provisional_new", "The eight legacy signals are unrelated firms sharing a downtown office address; none matches Wray James by name or domain."],
  "B012-EAST-18": ["update_existing", "The legacy row uses the George Street domain and represents a lawyer at the same firm; no live-ledger firm exists."],
  "B012-EAST-19": ["update_existing", "Two legacy rows have the same UL Lawyers name and domain; no live-ledger firm exists."],
  "B012-EAST-20": ["provisional_new", "The live reconciliation found no identity match; current first-party founder and roster evidence clears the earlier hold."],
};

const exclusions = {
  "B012-WN-H02": "Count is at_least rather than exact.",
  "B012-WN-H03": "Exact two-lawyer firm; legacy match is the same firm.",
  "B012-WN-H05": "The live reviewed fixture already contains the same firm and domain.",
  "B012-WN-H06": "Exact two-lawyer firm; legacy match is the same firm.",
  "B012-WN-H07": "The live ledger already contains rusolaw.ca and its count remains unknown.",
  "B012-WN-H08": "Exact two-lawyer firm; legacy signals are the same firm and a suite neighbour.",
  "B012-EAST-08": "The website's Ontario-firm identity could not be corroborated and its published phone number is in the United States.",
  "B012-EAST-09": "Lawyer count is unknown; legacy match is the same firm.",
  "B012-EAST-10": "Lawyer count is unknown; legacy matches are the same firm.",
  "B012-EAST-11": "Exact two-lawyer firm.",
  "B012-EAST-12": "Exact two-lawyer firm.",
  "B012-EAST-13": "Exact two-lawyer firm; legacy match is the same firm.",
  "B012-EAST-14": "Exact two-lawyer firm.",
  "B012-EAST-15": "Exact two-lawyer firm.",
  "B012-EAST-16": "Exact two-lawyer firm; legacy match is the same firm.",
};

const correctedCounts = { "B012-EAST-07": 9 };
const contactOverrides = {
  "B012-WN-01": [
    ["Herbert (Bert) Arnold", "founder", "htaesq@aol.com", "named_person", "https://www.arnold-foster.com/staff/"],
    ["Steven C. Foster", "founder", "sfoster@arnold-foster.com", "named_person", "https://www.arnold-foster.com/staff/"],
  ],
  "B012-EAST-02": [["Shannon Murphy", "named_lawyer", null, "named_person", "https://smurphyslaw.pssmlaw.com/contact-shannon"]],
  "B012-EAST-03": [["Robert Findlay", "founder", null, "named_person", "https://findlaylaw.ca/"]],
  "B012-EAST-04": [["Muhammad M. Alam", "founder", "malam@thealamlaw.com", "named_person", "https://www.thealamlaw.com/muhammad-alam"]],
  "B012-EAST-06": [["Mark Woitzik", "founder", null, "named_person", "https://durhamlawyer.ca/about-us/"]],
  "B012-EAST-17": [["Andrew Wray", "principal", "awray@wrayjames.com", "named_person", "https://wrayjames.com/contact-us/"]],
  "B012-EAST-18": [["Chris Rogers", "named_lawyer", "crogers@georgestreetlaw.ca", "named_person", "https://georgestreetlawgroup.com/chris-d-rogers/"]],
  "B012-EAST-19": [["Sunish Rai Uppal", "founder", null, "named_person", "https://ullaw.ca/"]],
  "B012-EAST-20": [["Allen Wynperle", "founder", "allen@dwalaw.ca", "named_person", "https://dwalaw.ca/allen-wynperle/"]],
};

const stable = (value) => Array.isArray(value)
  ? `[${value.map(stable).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const sha256 = (value) => createHash("sha256").update(stable(value)).digest("hex");
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const docs = files.map((path) => JSON.parse(readFileSync(path, "utf8")));
const records = docs.flatMap((doc) => doc.records);
const relationship = (value) => value === "owner" || value === "founder"
  ? value
  : value === "managing_partner" || value === "other_leadership" ? "principal" : "named_lawyer";
const contactsFor = (record) => {
  const overrides = (contactOverrides[record.record_id] ?? []).map(([name, rel, email, kind, url]) => ({
    name, relationship: rel, email, emailKind: kind, sourceUrl: url, observedAt: observedOn,
  }));
  const overridden = new Set(overrides.map((item) => item.name?.toLowerCase()).filter(Boolean));
  const people = record.leadership.filter((item) => !overridden.has(item.name.toLowerCase())).map((item) => ({
    name: item.name,
    relationship: relationship(item.relationship),
    email: null,
    emailKind: item.relationship === "owner" ? "owner" : "named_person",
    sourceUrl: item.url,
    observedAt: item.observed_on,
  }));
  const inboxes = record.public_emails.map((item) => ({
    name: null,
    relationship: "firm_inbox",
    email: item.email.toLowerCase(),
    emailKind: "general_firm",
    sourceUrl: item.url,
    observedAt: item.observed_on,
  }));
  return [...people, ...inboxes, ...overrides];
};

if (records.length !== 32 || Object.keys(importDecisions).length !== 17 || Object.keys(exclusions).length !== 15) {
  throw new Error("Batch 012 review must resolve 32 records into 17 imports and 15 exclusions.");
}

const importRecords = records.filter((record) => importDecisions[record.record_id]).map((record) => {
  const [status, basis] = importDecisions[record.record_id];
  const count = correctedCounts[record.record_id] ?? record.observed_lawyer_count;
  if (record.count_qualifier !== "exact" || !Number.isInteger(count) || count < 3 || count > 20) {
    throw new Error(`Imported record is outside the exact 3-20 lawyer gate: ${record.record_id}`);
  }
  const legacy = record.reconciliation.matches.filter((match) => match.origin === "legacy_source");
  return {
    id: `gta-prospect-012-${record.record_id.toLowerCase().replace(/^b012-/, "")}`,
    recordOrigin: "reviewed_batch_012",
    firmName: record.firm_name,
    city: record.office_cities[0],
    officeCities: record.office_cities,
    websiteUrl: `https://${record.canonical_domain}/`,
    practiceAreas: record.practice_areas_published,
    observedLawyerCount: count,
    observedLawyerCountQualifier: "exact",
    observedLawyerCountDisplay: null,
    rosterSourceUrl: record.evidence.find((item) => item.kind === "roster").url,
    rosterCheckedAt: correctedCounts[record.record_id] ? observedOn : record.observed_on,
    reconciliationStatus: status,
    legacyClusterLawyerCount: null,
    legacyCrosswalk: legacy.length ? legacy.map((match) => match.record_id).join("; ") : null,
    reconciliationNote: basis,
    advertisingEvidence: "unknown",
    advertisingSourceUrl: null,
    gbpEvidence: "unknown",
    gbpSourceUrl: null,
    publicContacts: contactsFor(record),
  };
});

const resolution = {
  schema_version: "gta-prospect-batch-012-reviewed-resolution.v1",
  batch_id: "gta-prospect-batch-012",
  reviewed_on: observedOn,
  live_operator_baseline_count: 124,
  candidate_count: records.length,
  import_count: importRecords.length,
  excluded_count: Object.keys(exclusions).length,
  automatic_merge: false,
  outreach_authorized: false,
  decisions: records.map((record) => ({
    source_record_key: record.record_id,
    firm_name: record.firm_name,
    observed_lawyer_count: correctedCounts[record.record_id] ?? record.observed_lawyer_count,
    count_qualifier: record.count_qualifier,
    disposition: importDecisions[record.record_id] ? "import" : "exclude",
    reconciliation_status: importDecisions[record.record_id]?.[0] ?? null,
    basis: importDecisions[record.record_id]?.[1] ?? exclusions[record.record_id],
  })),
};
const manifest = {
  schemaVersion: "gta-prospect-batch-012-reviewed-import-v1",
  purpose: "operator-authorized Batch 012 production import",
  generatedOn: observedOn,
  sourceResolutionSha256: sha256(resolution),
  expectedLiveBaselineCount: 124,
  expectedImportCount: importRecords.length,
  actionsExcluded: ["CRM write", "CRM contact creation", "outreach", "form submission", "automatic identity merge"],
  records: importRecords,
};

writeJson(resolve(root, "reviewed-resolution-2026-09-10.json"), resolution);
writeJson(resolve(root, "reviewed-import-manifest-2026-09-10.json"), manifest);
console.log(JSON.stringify({
  imports: importRecords.length,
  exclusions: Object.keys(exclusions).length,
  publicContacts: importRecords.reduce((sum, record) => sum + record.publicContacts.length, 0),
  manifestSha256: sha256(manifest),
}, null, 2));
