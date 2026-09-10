import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { RECONCILED_GTA_PROSPECTS } from "../src/app/admin/prospects/reconciled-prospects";
import { buildOperatorProspectBaseline } from "../src/lib/gta-prospect-baseline-reconciliation";
import { parseGtaProspectIdentitySnapshot } from "../src/lib/gta-prospect-identity-snapshot";
import { reconcileGtaProspectBatch012 } from "../src/lib/gta-prospect-live-baseline-gate";
import { legacyGtaSourceRecords } from "../src/lib/legacy-gta-prospect-source";

function values(flag: string): string[] {
  return process.argv.flatMap((value, index) => value === flag && process.argv[index + 1] ? [process.argv[index + 1]] : []);
}
function required(flag: string): string {
  const value = values(flag)[0];
  if (!value) throw new Error(`Missing required ${flag}.`);
  return value;
}
function json(path: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
}

try {
  const snapshotPath = required("--snapshot");
  const batchPaths = values("--batch");
  if (!batchPaths.length) throw new Error("At least one --batch is required.");
  const expectedCount = Number(required("--expected-count"));
  const maxAgeHours = Number(values("--max-age-hours")[0] ?? "24");
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) throw new Error("--max-age-hours must be positive.");
  const snapshot = parseGtaProspectIdentitySnapshot(json(snapshotPath), { expectedCount, maxAgeHours });
  const staticBaseline = buildOperatorProspectBaseline({
    fixtures: RECONCILED_GTA_PROSPECTS,
    ledgerProjection: [],
    legacySource: legacyGtaSourceRecords(),
  });
  const report = reconcileGtaProspectBatch012(snapshot, batchPaths.map(json), staticBaseline);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Live baseline verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
