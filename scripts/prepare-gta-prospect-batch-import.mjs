import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const fail = (message) => { throw new Error(`GTA prospect batch gate: ${message}`); };
const stable = (value) => Array.isArray(value)
  ? `[${value.map(stable).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const sha256 = (value) => createHash("sha256").update(stable(value)).digest("hex");
const json = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const option = (name, args) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? fail(`${name} needs a value`);
};

const args = process.argv.slice(2);
const reviewPath = option("--review", args);
const outputDir = option("--output-dir", args);
const checkOnly = args.includes("--check");
if (!reviewPath || !outputDir) {
  fail("usage: node scripts/prepare-gta-prospect-batch-import.mjs --review <review.json> --output-dir <directory> [--check]");
}

// Review files are deliberately hand-authored: this program validates and
// serializes a decision; it does not discover records, infer owners, or merge
// identities. `candidate` is the public-evidence record, and `decision` is a
// reviewer disposition for that exact record id.
const review = json(reviewPath);
if (review.schemaVersion !== "gta-prospect-batch-review.v1") fail("unsupported review schemaVersion");
if (!/^gta-prospect-batch-\d{3}$/.test(review.batchId ?? "")) fail("batchId must be gta-prospect-batch-NNN");
if (!/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedOn ?? "")) fail("reviewedOn must be ISO YYYY-MM-DD");
if (!Number.isInteger(review.expectedLiveBaselineCount) || review.expectedLiveBaselineCount < 0) fail("expectedLiveBaselineCount must be a non-negative integer");
if (!Array.isArray(review.candidates) || review.candidates.length === 0) fail("candidates must be a non-empty array");
if (!Array.isArray(review.decisions)) fail("decisions must be an array");
if (review.policy?.requiredRosterProvenance !== "first_party") fail("policy must require first_party roster provenance");
if (!Array.isArray(review.policy?.targetCountBands) || review.policy.targetCountBands.length === 0 || review.policy.targetCountBands.some((band) => !Number.isInteger(band.min) || !Number.isInteger(band.max) || band.min < 1 || band.max < band.min)) {
  fail("policy needs valid targetCountBands");
}

const candidateIds = new Set();
const candidates = new Map();
for (const candidate of review.candidates) {
  if (!candidate || typeof candidate !== "object") fail("every candidate must be an object");
  if (!/^[A-Za-z0-9-]+$/.test(candidate.recordId ?? "")) fail("candidate recordId is required");
  if (candidateIds.has(candidate.recordId)) fail(`duplicate candidate recordId: ${candidate.recordId}`);
  candidateIds.add(candidate.recordId);
  if (!candidate.firmName?.trim() || !candidate.canonicalDomain?.trim()) fail(`${candidate.recordId} needs firmName and canonicalDomain`);
  if (!Array.isArray(candidate.officeCities) || candidate.officeCities.length === 0) fail(`${candidate.recordId} needs at least one office city`);
  if (!Array.isArray(candidate.evidence) || !candidate.evidence.some((item) => item.kind === "roster" && item.url && item.provenance === "first_party")) fail(`${candidate.recordId} needs first-party roster evidence`);
  candidates.set(candidate.recordId, candidate);
}

const decisions = new Map();
for (const decision of review.decisions) {
  if (!candidates.has(decision.recordId)) fail(`decision names an unknown candidate: ${decision.recordId}`);
  if (decisions.has(decision.recordId)) fail(`duplicate decision: ${decision.recordId}`);
  if (!["import", "exclude", "hold"].includes(decision.disposition)) fail(`${decision.recordId} has an invalid disposition`);
  if (!decision.basis?.trim()) fail(`${decision.recordId} needs a review basis`);
  if (decision.disposition === "import" && !["provisional_new", "update_existing"].includes(decision.reconciliationStatus)) {
    fail(`${decision.recordId} import needs provisional_new or update_existing reconciliationStatus`);
  }
  if (decision.disposition !== "import" && decision.reconciliationStatus != null) fail(`${decision.recordId} non-import cannot set reconciliationStatus`);
  const reconciliation = decision.reconciliation;
  if (!reconciliation || !["no_match", "related_or_legacy_match", "existing_firm_match", "uncertain"].includes(reconciliation.staticBaseline) || !["no_match", "existing_firm_match", "uncertain"].includes(reconciliation.liveBaseline)) {
    fail(`${decision.recordId} needs explicit static and live baseline reconciliation outcomes`);
  }
  if (decision.disposition === "import" && reconciliation.liveBaseline !== "no_match") fail(`${decision.recordId} cannot import with a live identity match or uncertainty`);
  decisions.set(decision.recordId, decision);
}
if (decisions.size !== candidates.size) fail("every candidate requires exactly one decision");

const relationship = (value) => ({ owner: "owner", founder: "founder", managing_partner: "principal", other_leadership: "principal" }[value] ?? "named_lawyer");
const contactsFor = (candidate) => [
  ...(candidate.leadership ?? []).map((person) => ({
    name: person.name ?? null, relationship: relationship(person.relationship), email: person.email?.toLowerCase() ?? null,
    emailKind: person.email ? "named_person" : "named_person", sourceUrl: person.url, observedAt: person.observedOn ?? candidate.observedOn,
  })),
  ...(candidate.publicEmails ?? []).map((email) => ({
    name: null, relationship: "firm_inbox", email: email.email?.toLowerCase() ?? null, emailKind: "general_firm", sourceUrl: email.url, observedAt: email.observedOn ?? candidate.observedOn,
  })),
];

const imports = [];
const domains = new Set();
for (const candidate of review.candidates) {
  const decision = decisions.get(candidate.recordId);
  if (decision.disposition !== "import") continue;
  if (candidate.countQualifier !== "exact" || !Number.isInteger(candidate.observedLawyerCount) || candidate.observedLawyerCount < 3) {
    fail(`${candidate.recordId} import is outside the exact 3+ lawyer gate`);
  }
  if (!review.policy.targetCountBands.some((band) => candidate.observedLawyerCount >= band.min && candidate.observedLawyerCount <= band.max)) {
    fail(`${candidate.recordId} import is outside the selected targetCountBands`);
  }
  const domain = candidate.canonicalDomain.toLowerCase();
  if (domains.has(domain)) fail(`duplicate import canonicalDomain: ${domain}`);
  domains.add(domain);
  const rosterSourceUrl = candidate.evidence.find((item) => item.kind === "roster" && item.url).url;
  imports.push({
    id: `gta-prospect-${review.batchId.slice(-3)}-${candidate.recordId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    recordOrigin: `reviewed_${review.batchId.replaceAll("-", "_")}`,
    firmName: candidate.firmName, city: candidate.officeCities[0], officeCities: candidate.officeCities,
    websiteUrl: candidate.websiteUrl ?? `https://${candidate.canonicalDomain}/`, practiceAreas: candidate.practiceAreas ?? [],
    observedLawyerCount: candidate.observedLawyerCount, observedLawyerCountQualifier: "exact", observedLawyerCountDisplay: null,
    rosterSourceUrl, rosterCheckedAt: candidate.observedOn, reconciliationStatus: decision.reconciliationStatus,
    legacyClusterLawyerCount: null, legacyCrosswalk: candidate.legacyCrosswalk ?? null, reconciliationNote: decision.basis,
    advertisingEvidence: candidate.advertisingEvidence ?? "unknown", advertisingSourceUrl: candidate.advertisingSourceUrl ?? null,
    gbpEvidence: candidate.gbpEvidence ?? "unknown", gbpSourceUrl: candidate.gbpSourceUrl ?? null, publicContacts: contactsFor(candidate),
  });
}

const resolution = {
  schemaVersion: "gta-prospect-reviewed-resolution.v1", batchId: review.batchId, reviewedOn: review.reviewedOn,
  liveOperatorBaselineCount: review.expectedLiveBaselineCount, candidateCount: review.candidates.length, importCount: imports.length,
  excludedCount: [...decisions.values()].filter((item) => item.disposition === "exclude").length,
  heldCount: [...decisions.values()].filter((item) => item.disposition === "hold").length,
  automaticMerge: false, outreachAuthorized: false,
  policy: review.policy,
  decisions: review.candidates.map((candidate) => ({ sourceRecordKey: candidate.recordId, firmName: candidate.firmName, observedLawyerCount: candidate.observedLawyerCount ?? null, countQualifier: candidate.countQualifier ?? "unknown", disposition: decisions.get(candidate.recordId).disposition, reconciliationStatus: decisions.get(candidate.recordId).reconciliationStatus ?? null, reconciliation: decisions.get(candidate.recordId).reconciliation, basis: decisions.get(candidate.recordId).basis })),
};
const manifest = {
  schemaVersion: "gta-prospect-reviewed-import.v1", purpose: "reviewed GTA prospect production-import candidate; apply requires separate authorization", generatedOn: review.reviewedOn,
  sourceReviewFile: basename(reviewPath), sourceResolutionSha256: sha256(resolution), expectedLiveBaselineCount: review.expectedLiveBaselineCount, expectedImportCount: imports.length,
  actionsExcluded: ["CRM write", "CRM contact creation", "outreach", "form submission", "automatic identity merge"], records: imports,
};
const resolutionPath = resolve(outputDir, "reviewed-resolution.json");
const manifestPath = resolve(outputDir, "reviewed-import-manifest.json");
if (checkOnly) {
  for (const [path, expected] of [[resolutionPath, resolution], [manifestPath, manifest]]) {
    let actual; try { actual = json(path); } catch { fail(`missing generated artifact: ${path}`); }
    if (sha256(actual) !== sha256(expected)) fail(`generated artifact is stale: ${path}`);
  }
} else { writeJson(resolutionPath, resolution); writeJson(manifestPath, manifest); }
console.log(JSON.stringify({ batchId: review.batchId, imports: imports.length, excluded: resolution.excludedCount, held: resolution.heldCount, manifestSha256: sha256(manifest), checkOnly }, null, 2));
