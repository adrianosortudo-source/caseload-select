import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fixture = resolve(root, "scripts/fixtures/gta-prospect-batch-review.fixture.json");
const output = mkdtempSync(join(tmpdir(), "gta-prospect-pipeline-"));
const run = (review, extra = []) => execFileSync(process.execPath, ["scripts/prepare-gta-prospect-batch-import.mjs", "--review", review, "--output-dir", output, ...extra], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try {
  const result = JSON.parse(run(fixture));
  assert.equal(result.imports, 1); assert.equal(result.excluded, 1); assert.equal(result.held, 1);
  const manifest = JSON.parse(readFileSync(join(output, "reviewed-import-manifest.json"), "utf8"));
  assert.equal(manifest.records.length, 1); assert.equal(manifest.records[0].publicContacts.length, 2);
  run(fixture, ["--check"]);
  const malformed = JSON.parse(readFileSync(fixture, "utf8"));
  malformed.decisions = malformed.decisions.slice(0, 2);
  const malformedPath = join(output, "missing-decision.json"); writeFileSync(malformedPath, JSON.stringify(malformed));
  assert.throws(() => run(malformedPath), /every candidate requires exactly one decision/);
  console.log("GTA prospect batch pipeline fixture: passed");
} finally { rmSync(output, { recursive: true, force: true }); }
