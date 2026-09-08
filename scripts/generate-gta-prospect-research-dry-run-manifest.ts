#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildGtaProspectResearchManifest, type ResearchBatchInput } from "../src/lib/gta-prospect-research-manifest";

const ROOT = process.cwd();
const OUTPUT_PATH = "docs/prospecting/import-manifests/gta-prospect-research-accepted-001-009.dry-run.json";

const BATCHES = [
  ["001", "docs/prospecting/gta-prospect-batch-001/gta-prospect-batch-001.json", "docs/prospecting/reviews/gta-prospect-batch-001-validation.json"],
  ["002", "docs/research/gta-prospect-batch-002/gta-prospect-batch-002.json", "docs/prospecting/reviews/gta-prospect-batch-002-validation.json"],
  ["003", "docs/research/gta-prospect-batch-003/gta-prospect-batch-003.json", "docs/prospecting/reviews/gta-prospect-batch-003-validation.json"],
  ["004", "docs/research/gta-prospect-batch-004/gta-prospect-batch-004.json", "docs/prospecting/reviews/gta-prospect-batch-004-validation.json"],
  ["005", "docs/research/gta-prospect-batch-005/gta-prospect-batch-005.json", "docs/prospecting/reviews/gta-prospect-batch-005-validation.json"],
  ["006", "docs/research/gta-prospect-batch-006/gta-prospect-batch-006.json", "docs/prospecting/reviews/gta-prospect-batch-006-validation.json"],
  ["007", "docs/research/gta-prospect-batch-007/gta-prospect-batch-007.json", "docs/prospecting/reviews/gta-prospect-batch-007-validation.json"],
  ["008", "docs/research/gta-prospect-batch-008/gta-prospect-batch-008.json", "docs/prospecting/reviews/gta-prospect-batch-008-validation.json"],
  ["009", "docs/research/gta-prospect-batch-009/gta-prospect-batch-009.json", "docs/prospecting/reviews/gta-prospect-batch-009-validation.json"],
] as const;

async function readJson(relativePath: string) {
  return JSON.parse(await readFile(path.join(ROOT, relativePath), "utf8")) as Record<string, unknown>;
}

export async function buildFromRepository() {
  const batches: ResearchBatchInput[] = await Promise.all(BATCHES.map(async ([batchId, sourcePath, qaPath]) => ({
    batchId,
    sourcePath,
    qaPath,
    sourcePayload: await readJson(sourcePath),
    qaPayload: await readJson(qaPath),
  })));
  return buildGtaProspectResearchManifest(batches);
}

export async function main(argv = process.argv.slice(2)) {
  const write = argv.includes("--write");
  const manifest = await buildFromRepository();
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (write) {
    const output = path.join(ROOT, OUTPUT_PATH);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, serialized, "utf8");
  }
  console.log(JSON.stringify({
    mode: write ? "write_manifest" : "dry_run",
    outputPath: OUTPUT_PATH,
    acceptedRecordCount: manifest.importPlan.acceptedRecordCount,
    rejectedRecordCount: manifest.importPlan.rejectedRecordCount,
    excludedRecordCount: manifest.exclusions.length,
    sourceSha256: manifest.importPlan.sourceSha256,
    actionsNotPerformed: manifest.actionsNotPerformed,
  }, null, 2));
  return manifest;
}

if (process.argv[1]?.endsWith("generate-gta-prospect-research-dry-run-manifest.ts")) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
