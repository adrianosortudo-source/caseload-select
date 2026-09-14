import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SOURCE_SYSTEM = "legacy_gta_domain_discovery_v1";
const ADAPTER_VERSION = "legacy-downtown-domain-seed-v1";
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort(compare).map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function sha256(value) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function text(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function absoluteUrl(value) {
  const url = new URL(text(value));
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Unsupported source URL protocol: ${url.protocol}`);
  return url.toString();
}

function sourceRow(row) {
  return {
    sourceRowIndex: row.source_row_index,
    sourceRowKey: text(row.source_row_key),
    businessName: text(row.business_name),
    lawyerNames: text(row.lawyer_names),
    legacyLawyerCount: text(row.legacy_lawyer_count),
    street: text(row.street),
    city: text(row.city),
    postalCode: text(row.postal_code),
    websiteUrl: absoluteUrl(row.website_url),
    websiteConfidence: text(row.website_confidence),
    advertisingLegacySignal: text(row.advertising_legacy_signal),
    gbpLegacyFound: text(row.gbp_legacy_found),
  };
}

function advertisingWeight(signal) {
  return ({ advertising: 4000, likely_advertising: 3000, instrumented_only: 2000, no_signal: 500, unscanned: 0 })[signal] ?? 0;
}

function queueItem(candidate) {
  const rows = candidate.source_rows.map(sourceRow).sort((left, right) => compare(left.sourceRowKey, right.sourceRowKey));
  const observedBusinessNames = [...new Set(candidate.observed_business_names.map(text).filter(Boolean))].sort(compare);
  const addresses = [...new Set(rows.map((row) => [row.street, row.city, row.postalCode].filter(Boolean).join(", ")).filter(Boolean))].sort(compare);
  const sourceUrls = [...new Set(rows.map((row) => row.websiteUrl))].sort(compare);
  const identityNeedsReconciliation = candidate.identity_resolution !== "single_legacy_name";
  const maxAdvertisingWeight = Math.max(0, ...rows.map((row) => advertisingWeight(row.advertisingLegacySignal)));
  const priority = 1000
    + maxAdvertisingWeight
    + (rows.some((row) => row.gbpLegacyFound.toLocaleLowerCase("en-CA") === "no") ? 2500 : 0)
    + (identityNeedsReconciliation ? 1000 : 0)
    + (rows.length > 1 ? 250 : 0);
  const candidateName = text(candidate.candidate_name) || `Identity review: ${observedBusinessNames.join(" / ")}`;
  if (!candidateName || !candidate.candidate_id || !candidate.domain || sourceUrls.length !== 1) throw new Error(`Invalid normalized candidate ${candidate.candidate_id ?? "without-id"}.`);
  return {
    sourceRecordKey: text(candidate.candidate_id),
    candidateName,
    canonicalDomain: text(candidate.domain).toLocaleLowerCase("en-CA").replace(/^www\./, ""),
    candidateAddress: addresses.length === 1 ? addresses[0] : null,
    sourceUrls,
    priority,
    candidateSnapshot: {
      adapterVersion: ADAPTER_VERSION,
      manifestCandidateId: text(candidate.candidate_id),
      identityResolution: text(candidate.identity_resolution),
      observedBusinessNames,
      legacySourceRows: rows,
      evidenceBoundary: {
        geography: "discovery_only_not_plan41_proof",
        lawyerCount: "legacy_hint_not_current_roster_evidence",
        advertising: "legacy_hint_requires_current_observation",
        gbp: "legacy_hint_requires_current_observation",
      },
    },
  };
}

const inputArg = option("--input");
const outputArg = option("--output");
if (!inputArg || !outputArg) throw new Error("Usage: node scripts/prepare-gta-prospect-research-work-queue.mjs --input <manifest.json> --output <seed.json>");

const inputPath = resolve(inputArg);
const outputPath = resolve(outputArg);
const manifest = JSON.parse(await readFile(inputPath, "utf8"));
if (manifest?.schema_version !== "0.1" || !Array.isArray(manifest.candidates)) throw new Error("Unsupported downtown legacy domain manifest.");

const items = manifest.candidates.map(queueItem).sort((left, right) => compare(left.sourceRecordKey, right.sourceRecordKey));
const uniqueKeys = new Set(items.map((item) => item.sourceRecordKey));
const uniqueDomains = new Set(items.map((item) => item.canonicalDomain));
const legacySourceRows = items.reduce((sum, item) => sum + item.candidateSnapshot.legacySourceRows.length, 0);
const synthesizedNames = items.filter((item) => item.candidateName.startsWith("Identity review: ")).length;
const ambiguousAddresses = items.filter((item) => item.candidateAddress === null).length;
const multiRowCandidates = items.filter((item) => item.candidateSnapshot.legacySourceRows.length > 1).length;
const assertions = {
  items: items.length,
  uniqueSourceRecordKeys: uniqueKeys.size,
  uniqueCanonicalDomains: uniqueDomains.size,
  legacySourceRows,
  sourceProvidedNames: items.length - synthesizedNames,
  synthesizedIdentityReviewNames: synthesizedNames,
  unambiguousAddresses: items.length - ambiguousAddresses,
  ambiguousAddresses,
  identityReconciliationGroups: items.filter((item) => item.candidateSnapshot.identityResolution !== "single_legacy_name").length,
  multiRowCandidates,
};
const expected = {
  items: 495,
  uniqueSourceRecordKeys: 495,
  uniqueCanonicalDomains: 495,
  legacySourceRows: 553,
  sourceProvidedNames: 470,
  synthesizedIdentityReviewNames: 25,
  unambiguousAddresses: 459,
  ambiguousAddresses: 36,
  identityReconciliationGroups: 25,
  multiRowCandidates: 44,
};
if (stable(assertions) !== stable(expected)) throw new Error(`Manifest assertions changed: ${JSON.stringify(assertions)}`);

const hashPayload = {
  schemaVersion: manifest.schema_version,
  sourceSystem: SOURCE_SYSTEM,
  sourceArtifact: {
    sha256: manifest.source.sha256,
    artifactVersion: manifest.source.artifact_version,
    sourceRecordCount: manifest.source.source_record_count,
  },
  selection: {
    cityNormalization: manifest.selection.city_normalization,
    includedPostalFsas: [...manifest.selection.included_postal_fsas].sort(compare),
    requiredWebsiteUrl: manifest.selection.required_website_url,
  },
  items,
};
const seed = { sourceSystem: SOURCE_SYSTEM, sourceSha256: sha256(hashPayload), items };
const priorityDistribution = Object.fromEntries([...new Set(items.map((item) => item.priority))].sort((a, b) => b - a).map((priority) => [priority, items.filter((item) => item.priority === priority).length]));
const output = {
  schemaVersion: "1.0",
  purpose: "Private, evidence-bound discovery queue. This file does not establish current qualification.",
  adapterSummary: { ...assertions, priorityDistribution },
  seed,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, sourceSha256: seed.sourceSha256, ...assertions, priorityDistribution }, null, 2));
