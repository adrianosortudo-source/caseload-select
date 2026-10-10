import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./migration-gate.mjs";

export const PREFLIGHT_FILES = Object.freeze({
  source: "source-proof.json",
  ledger: "full-ledger.json",
  ledgerCheck: "full-ledger-check.json",
  catalog: "pre-catalog.json",
  catalogCheck: "pre-catalog-check.json",
  plan: "preflight-plan.json",
  planCheck: "plan-check.json",
  stage: "stage-proof.json",
  stageCheck: "stage-check.json",
});
export const PROJECTION_REPAIR_MIGRATION_SHA256 = "01a95245ecd1604ffde65ec4b82adfe1e7fca8b6cc7bd4ce6e46e53a8b173928";
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

export function createPreflightBinding(directory, environment) {
  if (!/^[1-9][0-9]*$/.test(environment.GITHUB_RUN_ID ?? "") ||
      environment.GITHUB_RUN_ATTEMPT !== "1" ||
      !/^[a-f0-9]{40}$/.test(environment.REVIEWED_SOURCE_SHA ?? "") ||
      !/^[a-f0-9]{64}$/.test(environment.REVIEWED_RECEIPT_SHA256 ?? "")) {
    throw new Error("candidate_projection_repair_binding_context_invalid");
  }
  const files = { ...PREFLIGHT_FILES };
  const sha256ByFile = Object.fromEntries(Object.entries(files).map(([key, name]) =>
    [key, sha256(fs.readFileSync(path.join(directory, name)))]));
  return {
    schemaVersion: "prospect-projection-repair-preflight/v1",
    runId: environment.GITHUB_RUN_ID,
    runAttempt: environment.GITHUB_RUN_ATTEMPT,
    sourceSha: environment.REVIEWED_SOURCE_SHA,
    receiptSha256: environment.REVIEWED_RECEIPT_SHA256,
    migrationSha256: PROJECTION_REPAIR_MIGRATION_SHA256,
    productionWrites: 0,
    recoveryAttempts: 0,
    files,
    sha256: sha256ByFile,
  };
}

export function verifyPreflightBinding(directory, binding, environment) {
  const fileKeys = Object.keys(PREFLIGHT_FILES);
  if (!exactKeys(binding, ["schemaVersion", "runId", "runAttempt", "sourceSha", "receiptSha256", "migrationSha256", "productionWrites", "recoveryAttempts", "files", "sha256"]) ||
      binding.schemaVersion !== "prospect-projection-repair-preflight/v1" ||
      binding.runId !== environment.GITHUB_RUN_ID ||
      binding.runAttempt !== "1" || environment.GITHUB_RUN_ATTEMPT !== "1" ||
      binding.sourceSha !== environment.REVIEWED_SOURCE_SHA ||
      binding.receiptSha256 !== environment.REVIEWED_RECEIPT_SHA256 ||
      binding.migrationSha256 !== environment.EXPECTED_MIGRATION_SHA256 ||
      binding.migrationSha256 !== PROJECTION_REPAIR_MIGRATION_SHA256 ||
      binding.productionWrites !== 0 || binding.recoveryAttempts !== 0 ||
      !exactKeys(binding.files, fileKeys) || !exactKeys(binding.sha256, fileKeys) ||
      fileKeys.some(key => binding.files[key] !== PREFLIGHT_FILES[key])) {
    throw new Error("candidate_projection_repair_binding_invalid");
  }
  for (const key of fileKeys) {
    const actual = sha256(fs.readFileSync(path.join(directory, binding.files[key])));
    if (actual !== binding.sha256[key]) throw new Error("candidate_projection_repair_binding_hash_mismatch");
  }
  return { verified: true, fileCount: fileKeys.length, runId: binding.runId, sourceSha: binding.sourceSha };
}

async function main([command, directory]) {
  if (!directory || !["create", "verify"].includes(command)) throw new Error("candidate_projection_repair_binding_usage_invalid");
  if (command === "create") {
    const binding = createPreflightBinding(directory, process.env);
    fs.writeFileSync(path.join(directory, "preflight-binding.json"), JSON.stringify(binding, null, 2) + String.fromCharCode(10));
    fs.appendFileSync(process.env.GITHUB_OUTPUT, "migration_sha256=" + binding.migrationSha256 + String.fromCharCode(10));
    process.stdout.write(JSON.stringify(binding) + String.fromCharCode(10));
    return;
  }
  const binding = JSON.parse(fs.readFileSync(path.join(directory, "preflight-binding.json"), "utf8"));
  const proof = verifyPreflightBinding(directory, binding, process.env);
  process.stdout.write(JSON.stringify(proof) + String.fromCharCode(10));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write((error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "candidate_projection_repair_binding_failed") + String.fromCharCode(10));
    process.exitCode = 1;
  });
}