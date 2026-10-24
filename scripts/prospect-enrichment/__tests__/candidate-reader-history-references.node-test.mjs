import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANDIDATE_READER_REPAIR_PATHS, HISTORICAL_LEDGER_NAME_ALIASES, stageProductionWorkdir, verifyFullMigrationLedger, verifyProductionWorkdir } from "../migration-gate.mjs";
import { readerHistoryQuery, stageReaderHistoryReferences, removeReaderHistoryReferences } from "../candidate-reader-history-references.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const expected = [
  { version: "20261013173327", name: "agency_followup_journeys", statement_count: 1, statements_sha256: "5f1de5211dd150df56fa83ee6755b26c66167f92c1836f692bd02b0c2f42c6b3" },
  { version: "20261013174258", name: "harden_agency_followup_events_privileges", statement_count: 1, statements_sha256: "50d504c06bc73115bf5a68551b7f76a58f434f3a06781b91af506da879a493dd" },
];

function tempStage(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "reader-history-stage-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, "supabase", "migrations"), { recursive: true });
  return base;
}

function copyPinnedRoot(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "reader-history-source-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const copy = path.join(base, "checkout");
  const directory = path.join(copy, "scripts", "prospect-enrichment");
  fs.mkdirSync(directory, { recursive: true });
  for (const file of [
    "bounded-original-ledger-reference.json",
    "bounded-original-release-review.json",
    "field-filter-ledger-reference.json",
    "field-filter-release-review.json",
  ]) fs.copyFileSync(path.join(root, "scripts/prospect-enrichment", file), path.join(directory, file));
  return copy;
}

function liveRows() {
  const reference = JSON.parse(fs.readFileSync(path.join(root, "scripts/prospect-enrichment/bounded-original-ledger-reference.json"), "utf8"));
  const rows = reference.ledger.map(row => ({ ...row }));
  rows.push(
    { version: "20261013214000", name: "prospect_bounded_original_evidence_v2", statement_count: 1, statements_sha256: "a".repeat(64) },
    { version: "20261014153626", name: "prospect_candidate_global_field_filter_fastpath", statement_count: 1, statements_sha256: "b".repeat(64) },
  );
  return rows.sort((a, b) => a.version.localeCompare(b.version));
}

test("reader history query returns only ordered version, name, count and statement hashes", () => {
  const query = readerHistoryQuery();
  assert.match(query, /SELECT version,name,coalesce\(cardinality\(statements\),0\) AS statement_count/);
  assert.match(query, /statements_sha256/);
  assert.match(query, /ORDER BY version/);
  assert.doesNotMatch(query, /SELECT .*statements FROM|CASE WHEN/);
});

test("only the two pinned applied agency rows become temporary execution-failing history references", t => {
  const stage = tempStage(t);
  const proof = stageReaderHistoryReferences(liveRows(), root, stage);
  assert.equal(proof.remoteVersionCount, 275);
  assert.deepEqual(proof.history, expected);
  assert.equal(proof.references.referenceHashNormalization, "UTF-8 with CRLF normalized to LF");
  assert.equal(proof.references.boundedReviewReceiptSha256, "a0f5085a3a81d6160b67b953ae5463641af6e73722aeec9fa6d58cfdd35474d4");
  assert.equal(proof.references.fieldFilterReviewReceiptSha256, "f7a0903962f839c5d5e7846f080a7222fb06fa47224bd520c2a60ba7ec8e8892");
  assert.equal(proof.compactLedger.length, 275);
  assert.deepEqual(proof.stagedFiles.map(file => file.filename), expected.map(row => `${row.version}_${row.name}.sql`));
  for (const row of expected) {
    const sql = fs.readFileSync(path.join(stage, "supabase", "migrations", `${row.version}_${row.name}.sql`), "utf8");
    assert.match(sql, /RAISE EXCEPTION 'reader_history_reference_execution_prohibited'/);
  }
  const { compactLedger, ...evidence } = proof;
  assert.equal(compactLedger.length, 275);
  assert.deepEqual(removeReaderHistoryReferences(root, stage, evidence), {
    removedGuardReferences: expected.map(row => `${row.version}_${row.name}.sql`), verified: true,
  });
  assert.deepEqual(fs.readdirSync(path.join(stage, "supabase", "migrations")), []);
});

test("review receipts are byte-pinned and bound to their exact migration identities", t => {
  for (const file of ["bounded-original-release-review.json", "field-filter-release-review.json"]) {
    const source = copyPinnedRoot(t);
    const receiptPath = path.join(source, "scripts/prospect-enrichment", file);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    receipt.migration.name = "unrelated_migration";
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
    const stage = tempStage(t);
    assert.throws(() => stageReaderHistoryReferences(liveRows(), source, stage), /reader_history_reference_receipt_mismatch/);
    assert.deepEqual(fs.readdirSync(path.join(stage, "supabase", "migrations")), []);
  }
});

test("missing, renamed, or statement-hash-changed live history fails before staging guards", t => {
  for (const mutate of [
    rows => rows.splice(rows.findIndex(row => row.version === expected[0].version), 1),
    rows => { rows.find(row => row.version === expected[0].version).name = "other_name"; },
    rows => { rows.find(row => row.version === expected[0].version).statements_sha256 = "f".repeat(64); },
  ]) {
    const rows = liveRows();
    mutate(rows);
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "reader-history-invalid-"));
    try {
      const stage = path.join(base, "stage");
      fs.mkdirSync(path.join(stage, "supabase", "migrations"), { recursive: true });
      assert.throws(() => stageReaderHistoryReferences(rows, root, stage), /reader_history_live_ledger_mismatch/);
      assert.deepEqual(fs.readdirSync(path.join(stage, "supabase", "migrations")), []);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  }
});

test("duplicate or unordered live history is rejected", t => {
  const rows = liveRows();
  rows.push({ ...rows[0] });
  const stage = tempStage(t);
  assert.throws(() => stageReaderHistoryReferences(rows, root, stage), /reader_history_live_ledger_invalid/);
});

test("guarded historical source references preserve the exact reader-repair suffix and restore a clean stage", t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "reader-history-full-stage-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const stage = path.join(base, "stage");
  const stageProof = stageProductionWorkdir(root, stage);
  assert.equal(path.dirname(fs.realpathSync(base)), fs.realpathSync(os.tmpdir()));
  const stageStat = fs.lstatSync(stage);
  assert.equal(stageStat.isDirectory(), true);
  assert.equal(stageStat.isSymbolicLink(), false);
  const stagedRoot = fs.realpathSync(stage);
  assert.equal(stageProof.stagedRoot, stagedRoot);
  assert.equal(path.dirname(stagedRoot), fs.realpathSync(base));
  const relativeToSource = path.relative(fs.realpathSync(root), stagedRoot);
  assert.ok(path.isAbsolute(relativeToSource) || relativeToSource === ".." || relativeToSource.startsWith(`..${path.sep}`));
  const expectedPaths = expected.map(row => path.join(stagedRoot, "supabase", "migrations", `${row.version}_${row.name}.sql`));
  const expectedBytes = [];
  for (const filename of expectedPaths) {
    const stat = fs.lstatSync(filename);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
    const bytes = fs.readFileSync(filename);
    assert.deepEqual(bytes, fs.readFileSync(path.join(root, "supabase", "migrations", path.basename(filename))));
    expectedBytes.push(bytes);
  }
  for (const filename of expectedPaths) fs.rmSync(filename);
  const pendingVersions = new Set(CANDIDATE_READER_REPAIR_PATHS.map(item => path.basename(item).split("_")[0]));
  const expectedVersions = new Set(expected.map(row => row.version));
  const activeRows = fs.readdirSync(path.join(stage, "supabase", "migrations")).sort()
    .filter(filename => !pendingVersions.has(filename.split("_")[0]) && !expectedVersions.has(filename.split("_")[0]))
    .map(filename => {
      const [version, ...tail] = filename.slice(0, -4).split("_");
      const name = tail.join("_");
      const alias = HISTORICAL_LEDGER_NAME_ALIASES[version];
      return {
        version,
        name: alias?.filename === filename ? alias.name : name,
        statement_count: 1,
        statements_sha256: "c".repeat(64),
      };
    });
  const rows = [...activeRows, ...expected].sort((a, b) => a.version.localeCompare(b.version));
  const historyProof = stageReaderHistoryReferences(rows, root, stage);
  const ledger = verifyFullMigrationLedger(historyProof.compactLedger, stage, "candidate-reader-repair-pending", CANDIDATE_READER_REPAIR_PATHS);
  assert.deepEqual(ledger.pendingPaths, CANDIDATE_READER_REPAIR_PATHS);
  const { compactLedger, ...historyEvidence } = historyProof;
  removeReaderHistoryReferences(root, stage, historyEvidence);
  expectedPaths.forEach((filename, index) => fs.writeFileSync(filename, expectedBytes[index], { flag: "wx" }));
  expectedPaths.forEach((filename, index) => assert.deepEqual(fs.readFileSync(filename), expectedBytes[index]));
  assert.equal(verifyProductionWorkdir(root, stage, stageProof).verified, true);
});

