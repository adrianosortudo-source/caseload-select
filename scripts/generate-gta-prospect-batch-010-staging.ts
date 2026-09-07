import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildGtaProspectImportPlan } from "../src/lib/gta-prospect-research-import";

type JsonRecord = Record<string, unknown>;

const root = process.cwd();
const lanes = ["core", "west-north", "east-outer"] as const;
const excludedDuplicateSourceIds = new Set(["B010-EAST-20"]);
const outputPath = path.join(root, "docs/prospecting/import-manifests/gta-prospect-research-batch-010.staging.json");

const readJson = async (relativePath: string) =>
  JSON.parse(await readFile(path.join(root, relativePath), "utf8")) as JsonRecord;

const records = (payload: JsonRecord, label: string): JsonRecord[] => {
  const value = payload.records ?? payload.dispositions;
  if (!Array.isArray(value) || !value.every(item => item && typeof item === "object" && !Array.isArray(item))) {
    throw new Error(`${label} must contain records or dispositions.`);
  }
  return value as JsonRecord[];
};

const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
};

const stringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || !value.every(item => typeof item === "string" && item.trim())) {
    throw new Error(`${label} must be a non-empty string array.`);
  }
  return value as string[];
};

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as JsonRecord).sort().map(key => `${JSON.stringify(key)}:${stable((value as JsonRecord)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const sha256 = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");

const sourceKey = (sourceId: string) =>
  `gta-prospect-010-${sourceId}`.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const main = async () => {
  const sourceById = new Map<string, { lane: string; path: string; record: JsonRecord }>();
  const qaById = new Map<string, { lane: string; path: string; record: JsonRecord }>();
  const sourceFiles: { lane: string; path: string; sha256: string; recordCount: number }[] = [];
  const qaFiles: { lane: string; path: string; sha256: string; recordCount: number }[] = [];

  for (const lane of lanes) {
    const sourcePath = `docs/research/gta-prospect-batch-010/lanes/${lane}.json`;
    const qaPath = `docs/prospecting/reviews/gta-prospect-batch-010/${lane}-validation.json`;
    const sourcePayload = await readJson(sourcePath);
    const qaPayload = await readJson(qaPath);
    const sourceRecords = records(sourcePayload, sourcePath);
    const qaRecords = records(qaPayload, qaPath);
    sourceFiles.push({ lane, path: sourcePath, sha256: sha256(sourcePayload), recordCount: sourceRecords.length });
    qaFiles.push({ lane, path: qaPath, sha256: sha256(qaPayload), recordCount: qaRecords.length });

    for (const record of sourceRecords) {
      const id = text(record.record_id, `${sourcePath} record id`);
      if (sourceById.has(id)) throw new Error(`Duplicate source record id ${id}.`);
      sourceById.set(id, { lane, path: sourcePath, record });
    }
    for (const record of qaRecords) {
      const id = text(record.record_id, `${qaPath} record id`);
      if (qaById.has(id)) throw new Error(`Duplicate QA record id ${id}.`);
      qaById.set(id, { lane, path: qaPath, record });
    }
  }

  const candidates = [...sourceById.values()].filter(({ record }) => record.workflow_status === "candidate");
  if (sourceById.size !== 100 || candidates.length !== 51 || qaById.size !== candidates.length) {
    throw new Error(`Batch 010 integrity failed: ${sourceById.size} sources, ${candidates.length} candidates, ${qaById.size} QA records.`);
  }
  for (const id of qaById.keys()) if (!sourceById.has(id)) throw new Error(`QA record ${id} has no source record.`);

  const inputs: JsonRecord[] = [];
  const provenance: JsonRecord[] = [];
  const exclusions: JsonRecord[] = [];

  for (const [id, sourceEntry] of [...sourceById.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const qaEntry = qaById.get(id);
    if (!qaEntry) {
      exclusions.push({ sourceRecordId: id, disposition: "held_at_lane_review", reason: "No candidate promotion was requested at lane review." });
      continue;
    }

    const disposition = text(qaEntry.record.disposition, `${id} QA disposition`);
    if (disposition !== "accepted_for_staging" || excludedDuplicateSourceIds.has(id)) {
      exclusions.push({
        sourceRecordId: id,
        disposition: excludedDuplicateSourceIds.has(id) ? "duplicate_collapsed" : disposition,
        reason: excludedDuplicateSourceIds.has(id)
          ? "Duplicate of B010-WN-14 (Feldstein Family Law Group / separation.ca); retained once in the central staging pool."
          : (qaEntry.record.rationale ?? null),
      });
      continue;
    }

    const source = sourceEntry.record;
    const qa = qaEntry.record;
    const officeCities = stringArray(qa.office_cities ?? source.office_cities, `${id} office cities`);
    const observedLawyerCount = qa.observed_lawyer_count ?? qa.live_observed_lawyer_count ?? source.observed_lawyer_count;
    const countQualifier = qa.count_qualifier ?? qa.live_count_qualifier ?? source.count_qualifier;
    if (!Number.isInteger(observedLawyerCount) || (observedLawyerCount as number) < 0) throw new Error(`${id} has no valid reviewed lawyer count.`);
    if (countQualifier !== "exact" && countQualifier !== "at_least") throw new Error(`${id} has no valid reviewed count qualifier.`);
    const rosterSourceUrl = text(qa.first_party_roster_url ?? source.first_party_roster_url, `${id} roster source URL`);
    const observedOn = text(qa.source_observation_date ?? source.observation_date, `${id} observation date`);
    const canonicalDomain = text(qa.canonical_domain ?? source.canonical_domain, `${id} canonical domain`);
    const raw = {
      id: sourceKey(id),
      firmName: text(qa.firm_name ?? source.firm_name, `${id} firm name`),
      city: officeCities[0],
      officeCities,
      websiteUrl: null,
      practiceAreas: stringArray(source.practice_areas_published, `${id} practice areas`),
      observedLawyerCount,
      observedLawyerCountQualifier: countQualifier,
      observedLawyerCountDisplay: null,
      rosterSourceUrl,
      rosterCheckedAt: observedOn,
      reconciliationStatus: "provisional_new",
      legacyClusterLawyerCount: null,
      legacyCrosswalk: null,
      reconciliationNote: "Legacy reconciliation is unknown: no stable row-level crosswalk is present in the historical address-cluster artifact.",
      advertisingEvidence: "unknown",
      advertisingSourceUrl: null,
      gbpEvidence: "unknown",
      gbpSourceUrl: null,
    } as const;
    inputs.push(raw);
    provenance.push({
      sourceRecordKey: raw.id,
      batchSourceRecordId: id,
      sourcePath: sourceEntry.path,
      qaPath: qaEntry.path,
      canonicalDomain,
      rosterSourceUrl,
      observedOn,
      observedLawyerCount,
      observedLawyerCountQualifier: countQualifier,
      centralDecision: id === "B010-C-29" ? "Canonical domain corrected to whittenlublin.com; original hostname remains a source alias." : "accepted_after_independent_review",
    });
  }

  const plan = await buildGtaProspectImportPlan(inputs);
  if (plan.rejected.length) throw new Error(`Staging records fail importer validation: ${JSON.stringify(plan.rejected)}.`);
  if (plan.accepted.length !== 30) throw new Error(`Expected 30 unique staging records, found ${plan.accepted.length}.`);

  const payload = {
    schemaVersion: "gta-prospect-batch-010-staging-v1",
    purpose: "offline staging review only",
    actionsNotPerformed: ["database connection", "migration application", "data import", "CRM activity", "contact or outreach", "deployment", "merge"],
    researchDenominator: { researchedFirmCount: sourceById.size, candidateCount: candidates.length, sourceHeldCount: sourceById.size - candidates.length },
    independentReview: { acceptedBeforeCentralDeduplication: 31, held: 7, rejected: 13, uniqueStagingCount: plan.accepted.length },
    sourceFiles,
    qaFiles,
    importPlan: { sourceSha256: plan.sourceSha256, acceptedRecordCount: plan.accepted.length, rejectedRecordCount: plan.rejected.length },
    importRecords: plan.accepted,
    provenance: provenance.sort((left, right) => String(left.sourceRecordKey).localeCompare(String(right.sourceRecordKey))),
    exclusions: exclusions.sort((left, right) => String(left.sourceRecordId).localeCompare(String(right.sourceRecordId))),
  };
  const rendered = `${JSON.stringify(payload, null, 2)}\n`;

  if (process.argv.includes("--write")) {
    await writeFile(outputPath, rendered, "utf8");
    return;
  }
  const existing = await readFile(outputPath, "utf8");
  if (existing !== rendered) throw new Error(`Staging manifest is out of date. Run: tsx scripts/generate-gta-prospect-batch-010-staging.ts --write`);
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
